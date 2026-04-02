const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const port = process.env.PORT || 5000;
const apiKey = process.env.GEMINI_API_KEY;
const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

if (!apiKey) {
    console.warn('GEMINI_API_KEY is not set. Add it to backend/.env before using the AI routes.');
}

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
const model = genAI ? genAI.getGenerativeModel({ model: modelName }) : null;

app.post('/analyze', async (req, res) => {
    const { bookName } = req.body;

    if (!bookName || !bookName.trim()) {
        return res.status(400).json({ error: 'Book name is required.' });
    }

    if (!model) {
        return res.status(500).json({ error: 'Missing GEMINI_API_KEY in backend/.env.' });
    }

    try {
        const prompt = `
You are an expert literature tutor for school and college students.
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

        return res.json(analysis);
    } catch (error) {
        console.error('Analyze error:', error);
        return res.status(500).json({ error: error.message || 'Failed to generate literary analysis.' });
    }
});

app.post('/chat', async (req, res) => {
    const { prompt, bookTitle, analysis } = req.body;

    if (!prompt || !prompt.trim()) {
        return res.status(400).json({ error: 'Prompt is required.' });
    }

    if (!model) {
        return res.status(500).json({ error: 'Missing GEMINI_API_KEY in backend/.env.' });
    }

    try {
        const chatPrompt = `
You are an encouraging AI literature tutor.
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
- Keep the response under 220 words.
        `.trim();

        const reply = await generateText(chatPrompt);
        return res.json({ reply });
    } catch (error) {
        console.error('Chat error:', error);
        return res.status(500).json({ error: error.message || 'Failed to generate tutor response.' });
    }
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});

async function generateText(prompt) {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
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
