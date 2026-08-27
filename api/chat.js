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

app.use(express.json());

app.post('/', async (req, res) => {
    const { prompt, bookTitle, analysis } = req.body;

    if (!prompt || !prompt.trim()) {
        return res.status(400).json({
            error: 'Prompt is required.'
        });
    }

    if (!apiKey) {
        return res.status(500).json({
            error: missingApiKeyMessage
        });
    }

    try {
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

        return res.json({
            reply
        });

    } catch (error) {
        console.error('Chat error:', error);

        return res.status(500).json({
            error: getUserFacingErrorMessage(
                error,
                'Failed to generate tutor response.'
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