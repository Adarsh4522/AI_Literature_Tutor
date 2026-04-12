const fs = require('fs');
const express = require('express');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });

const missingApiKeyMessage = 'Missing GROQ_API_KEY. Set it in backend/.env for local runs or pass it to Docker with -e/--env-file.';
const highTrafficMessage = 'LitWise is experiencing high AI traffic. Please try again in a few seconds.';
const analysisCacheFile = path.join(__dirname, 'cache', 'analysis-cache.json');
const groqApiUrl = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';

const app = express();
const port = process.env.PORT || 5000;
const apiKey = process.env.GROQ_API_KEY;
const modelName = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const analysisCache = loadAnalysisCache();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

if (!apiKey) {
    console.warn(missingApiKeyMessage);
}

app.post('/analyze', async (req, res) => {
    const { bookName } = req.body;
    const cacheKey = normalizeCacheKey(bookName);

    if (!bookName || !bookName.trim()) {
        return res.status(400).json({ error: 'Book name is required.' });
    }

    if (analysisCache[cacheKey]) {
        return res.json(analysisCache[cacheKey]);
    }

    if (!apiKey) {
        return res.status(500).json({ error: missingApiKeyMessage });
    }

    try {
        const prompt = `
You are LitWise, an expert literature tutor for school and college students.
Analyze the work "${bookName}" and respond with valid JSON only.

Return an object with this exact shape:
{
  "title": "string",
  "summary": "120-180 word student-friendly summary",
  "whyItMatters": "2-3 sentence explanation of literary significance",
  "themes": ["4 to 6 short theme labels"],
  "characters": ["4 to 6 important characters with brief role notes"],
  "discussionQuestions": ["3 thoughtful classroom discussion questions"],
  "studyTips": ["3 concise revision or essay tips"]
}

Rules:
- If the title is ambiguous, make a reasonable best guess.
- Keep all values plain text.
- Do not include markdown fences.
- Do not include any commentary before or after the JSON.
        `.trim();

        const rawText = await generateText(prompt);
        const analysis = parseAnalysisResponse(rawText, bookName);
        cacheAnalysis(cacheKey, analysis);

        return res.json(analysis);
    } catch (error) {
        console.error('Analyze error:', error);
        return res.status(500).json({ error: getUserFacingErrorMessage(error, 'Failed to generate literary analysis.') });
    }
});

app.post('/chat', async (req, res) => {
    const { prompt, bookTitle, analysis } = req.body;

    if (!prompt || !prompt.trim()) {
        return res.status(400).json({ error: 'Prompt is required.' });
    }

    if (!apiKey) {
        return res.status(500).json({ error: missingApiKeyMessage });
    }

    try {
        const wantsFullStory = asksForFullStory(prompt);
        const chatPrompt = `
You are LitWise, an encouraging AI literature tutor.
Student question: "${prompt}"

Current book: "${bookTitle || 'Not specified'}"

Known analysis:
${JSON.stringify(analysis || {}, null, 2)}

Instructions:
- Answer in a warm, helpful teaching tone.
- Keep the response focused on literature learning.
- If a book is provided, tailor the answer to that text.
- If the student asks for essay help, include a clear thesis direction.
- If the question is unclear, make a helpful best effort instead of refusing.
- If the student explicitly asks for the whole story, full plot, or complete story, give a fuller spoiler-aware retelling with the major events from beginning to end in 450-700 words.
- Otherwise, keep the response under 220 words.
        `.trim();

        const reply = await generateText(chatPrompt);
        return res.json({ reply });
    } catch (error) {
        console.error('Chat error:', error);
        return res.status(500).json({ error: getUserFacingErrorMessage(error, 'Failed to generate tutor response.') });
    }
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});

async function generateText(prompt) {
    const response = await fetch(groqApiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: modelName,
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.7
        })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw buildProviderError(response.status, payload);
    }

    return String(payload?.choices?.[0]?.message?.content || '').trim();
}

function parseAnalysisResponse(rawText, fallbackTitle) {
    const cleaned = stripCodeFences(rawText);

    try {
        const parsed = JSON.parse(cleaned);
        return normalizeAnalysis(parsed, fallbackTitle);
    } catch (error) {
        console.warn('JSON parse failed, using fallback parser.');
        return fallbackAnalysisFromText(cleaned, fallbackTitle);
    }
}

function stripCodeFences(text) {
    return text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
}

function normalizeAnalysis(analysis, fallbackTitle) {
    return {
        title: analysis.title || fallbackTitle,
        summary: analysis.summary || 'Summary unavailable.',
        whyItMatters: analysis.whyItMatters || 'Literary significance unavailable.',
        themes: ensureArray(analysis.themes),
        characters: ensureArray(analysis.characters),
        discussionQuestions: ensureArray(analysis.discussionQuestions),
        studyTips: ensureArray(analysis.studyTips)
    };
}

function fallbackAnalysisFromText(text, fallbackTitle) {
    return {
        title: fallbackTitle,
        summary: text || 'Summary unavailable.',
        whyItMatters: 'This text is significant for its themes, character development, and literary interpretation.',
        themes: ['Identity', 'Conflict', 'Society'],
        characters: ['Main character', 'Supporting character'],
        discussionQuestions: [
            'What central conflict drives the text?',
            'How do the main themes shape the characters?',
            'What message might the author want readers to consider?'
        ],
        studyTips: [
            'Track major themes with short quotes.',
            'Connect character actions to the author message.',
            'Use clear topic sentences in essay responses.'
        ]
    };
}

function ensureArray(value) {
    return Array.isArray(value) ? value : [];
}

function asksForFullStory(prompt) {
    const normalizedPrompt = String(prompt).toLowerCase();

    return [
        'whole story',
        'full story',
        'complete story',
        'entire story',
        'whole plot',
        'full plot',
        'complete plot',
        'entire plot',
        'story from beginning to end',
        'plot from beginning to end',
        'tell me the whole story',
        'tell me the full story',
        'summarize the whole story'
    ].some((phrase) => normalizedPrompt.includes(phrase));
}

function getUserFacingErrorMessage(error, fallbackMessage) {
    const rawMessage = String(error?.message || '').toLowerCase();

    if (
        rawMessage.includes('503') ||
        rawMessage.includes('service unavailable') ||
        rawMessage.includes('high demand') ||
        rawMessage.includes('rate limit') ||
        rawMessage.includes('too many requests') ||
        rawMessage.includes('unavailable')
    ) {
        return highTrafficMessage;
    }

    return error?.message || fallbackMessage;
}

function buildProviderError(status, payload) {
    const providerMessage =
        payload?.error?.message ||
        payload?.detail ||
        payload?.message ||
        `Groq request failed with status ${status}.`;
    const error = new Error(providerMessage);

    error.status = status;
    error.payload = payload;

    return error;
}

function loadAnalysisCache() {
    try {
        ensureCacheDirExists();

        if (!fs.existsSync(analysisCacheFile)) {
            fs.writeFileSync(analysisCacheFile, '{}');
            return {};
        }

        return JSON.parse(fs.readFileSync(analysisCacheFile, 'utf8'));
    } catch (error) {
        console.warn('Could not load analysis cache:', error.message);
        return {};
    }
}

function cacheAnalysis(cacheKey, analysis) {
    const normalizedTitleKey = normalizeCacheKey(analysis?.title || '');

    analysisCache[cacheKey] = analysis;

    if (normalizedTitleKey) {
        analysisCache[normalizedTitleKey] = analysis;
    }

    try {
        ensureCacheDirExists();
        fs.writeFileSync(analysisCacheFile, JSON.stringify(analysisCache, null, 2));
    } catch (error) {
        console.warn('Could not persist analysis cache:', error.message);
    }
}

function ensureCacheDirExists() {
    fs.mkdirSync(path.dirname(analysisCacheFile), { recursive: true });
}

function normalizeCacheKey(value) {
    return String(value || '').trim().toLowerCase();
}
