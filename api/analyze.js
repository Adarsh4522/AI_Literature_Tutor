const express = require('express');

const app = express();

const apiKey = process.env.GROQ_API_KEY;
const groqApiUrl =
    process.env.GROQ_API_URL ||
    'https://api.groq.com/openai/v1/chat/completions';

const modelName =
    process.env.GROQ_MODEL ||
    'llama-3.1-8b-instant';

const missingApiKeyMessage =
    'Missing GROQ_API_KEY. Please configure it in the environment variables.';

const highTrafficMessage =
    'LitWise is experiencing high AI traffic. Please try again in a few seconds.';

const analysisCache = {};

app.use(express.json());

app.post('/', async (req, res) => {
    const { bookName } = req.body;

    if (!bookName || !bookName.trim()) {
        return res.status(400).json({
            error: 'Book name is required.'
        });
    }

    const cacheKey = normalizeCacheKey(bookName);

    if (analysisCache[cacheKey]) {
        return res.json(analysisCache[cacheKey]);
    }

    if (!apiKey) {
        return res.status(500).json({
            error: missingApiKeyMessage
        });
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

        analysisCache[cacheKey] = analysis;

        const normalizedTitleKey =
            normalizeCacheKey(analysis.title);

        if (normalizedTitleKey) {
            analysisCache[normalizedTitleKey] = analysis;
        }

        return res.json(analysis);

    } catch (error) {
        console.error('Analyze error:', error);

        return res.status(500).json({
            error: getUserFacingErrorMessage(
                error,
                'Failed to generate literary analysis.'
            )
        });
    }
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

    const payload =
        await response.json().catch(() => ({}));

    if (!response.ok) {
        throw buildProviderError(response.status, payload);
    }

    return String(
        payload?.choices?.[0]?.message?.content || ''
    ).trim();
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
    return String(text || '')
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
}

function normalizeAnalysis(analysis, fallbackTitle) {
    return {
        title: analysis.title || fallbackTitle,
        summary: analysis.summary || 'Summary unavailable.',
        whyItMatters:
            analysis.whyItMatters ||
            'Literary significance unavailable.',
        themes: ensureArray(analysis.themes),
        characters: ensureArray(analysis.characters),
        discussionQuestions:
            ensureArray(analysis.discussionQuestions),
        studyTips: ensureArray(analysis.studyTips)
    };
}

function fallbackAnalysisFromText(text, fallbackTitle) {
    return {
        title: fallbackTitle,
        summary: text || 'Summary unavailable.',
        whyItMatters:
            'This text is significant for its themes, character development, and literary interpretation.',
        themes: ['Identity', 'Conflict', 'Society'],
        characters: [
            'Main character',
            'Supporting character'
        ],
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

function normalizeCacheKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase();
}

function getUserFacingErrorMessage(error, fallbackMessage) {
    const rawMessage =
        String(error?.message || '').toLowerCase();

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

    return new Error(providerMessage);
}

module.exports = app;