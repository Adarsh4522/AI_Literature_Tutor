const fs = require('fs');
const express = require('express');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({
    path: path.join(__dirname, '.env'),
    quiet: true
});

const missingApiKeyMessage =
    'Missing GROQ_API_KEY. Set it in backend/.env for local runs or pass it to Docker with -e/--env-file.';

const highTrafficMessage =
    'LitWise is experiencing high AI traffic. Please try again in a few seconds.';

const analysisCacheFile = path.join(
    __dirname,
    'cache',
    'analysis-cache.json'
);

const groqApiUrl =
    process.env.GROQ_API_URL ||
    'https://api.groq.com/openai/v1/chat/completions';

const app = express();

const port = process.env.PORT || 5000;

const apiKey = process.env.GROQ_API_KEY;

const modelName =
    process.env.GROQ_MODEL ||
    'openai/gpt-oss-20b';

const analysisCache = loadAnalysisCache();


// --------------------------------------------------
// MIDDLEWARE
// --------------------------------------------------

app.use(express.json());

app.use(
    express.static(
        path.join(__dirname, '..')
    )
);


if (!apiKey) {
    console.warn(missingApiKeyMessage);
}


// --------------------------------------------------
// ANALYZE BOOK
// --------------------------------------------------

app.post('/analyze', async (req, res) => {
    const { bookName } = req.body;

    if (!bookName || !bookName.trim()) {
        return res.status(400).json({
            error: 'Book name is required.'
        });
    }

    const cacheKey = normalizeCacheKey(bookName);


    // --------------------------------------------------
    // CHECK CACHE
    // --------------------------------------------------

    if (analysisCache[cacheKey]) {
        console.log(
            `Returning cached analysis for: ${bookName}`
        );

        return res.json(
            analysisCache[cacheKey]
        );
    }


    // --------------------------------------------------
    // CHECK API KEY
    // --------------------------------------------------

    if (!apiKey) {
        return res.status(500).json({
            error: missingApiKeyMessage
        });
    }


    try {

        const prompt = `
You are LitWise, an expert literature tutor for school and college students.

Analyze the literary work "${bookName}".

Return a complete literature analysis suitable for students.

Return a JSON object with exactly these fields:

{
  "title": "string",
  "summary": "120-180 word student-friendly summary",
  "whyItMatters": "2-3 sentence explanation of literary significance",
  "themes": ["theme 1", "theme 2", "theme 3"],
  "characters": ["Character Name — short role description"],
  "discussionQuestions": ["question 1", "question 2", "question 3"],
  "studyTips": ["tip 1", "tip 2", "tip 3"]
}

Rules:
- Make the analysis specific to "${bookName}".
- Do not use generic placeholder information.
- themes must be an array of plain text strings.
- characters must be an array of plain text strings.
- discussionQuestions must be an array of plain text strings.
- studyTips must be an array of plain text strings.
- Keep all values as plain text.
- Do not use Markdown.
- Do not use code fences.
- Return only valid JSON.
- If the title is ambiguous, make a reasonable best guess.
`.trim();


        // IMPORTANT:
        // true tells generateText() to use strict JSON schema mode.
        const rawText = await generateText(
            prompt,
            true
        );


        const analysis = parseAnalysisResponse(
            rawText,
            bookName
        );


        // --------------------------------------------------
        // SAVE TO CACHE
        // --------------------------------------------------

        cacheAnalysis(
            cacheKey,
            analysis
        );


        return res.json(
            analysis
        );

    } catch (error) {

        console.error(
            'Analyze error:',
            error
        );

        return res.status(500).json({
            error: getUserFacingErrorMessage(
                error,
                'Failed to generate literary analysis.'
            )
        });
    }
});


// --------------------------------------------------
// CHAT WITH LITWISE
// --------------------------------------------------

app.post('/chat', async (req, res) => {

    const {
        prompt,
        bookTitle,
        analysis
    } = req.body;


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

        const wantsFullStory =
            asksForFullStory(prompt);


        const chatPrompt = `
You are LitWise, an encouraging AI literature tutor.

Student question:
"${prompt}"

Current book:
"${bookTitle || 'Not specified'}"

Known analysis:
${JSON.stringify(
    analysis || {},
    null,
    2
)}

Instructions:

- Answer in a warm, helpful teaching tone.
- Keep the response focused on literature learning.
- If a book is provided, tailor the answer to that text.
- If the student asks for essay help, include a clear thesis direction.
- If the question is unclear, make a helpful best effort instead of refusing.

${
    wantsFullStory
        ? `
The student explicitly wants the whole story, complete plot, or full story.

Provide a fuller spoiler-aware retelling covering the major events from beginning to end.

Target approximately 450-700 words.
`
        : `
Keep the response concise and student-friendly.

Target under 220 words unless additional explanation is genuinely necessary.
`
}
        `.trim();


        // IMPORTANT:
        // Do NOT pass true here.
        //
        // Chat should return normal text,
        // not JSON Schema output.

        const reply = await generateText(
            chatPrompt
        );


        return res.json({
            reply
        });

    } catch (error) {

        console.error(
            'Chat error:',
            error
        );

        return res.status(500).json({
            error: getUserFacingErrorMessage(
                error,
                'Failed to generate tutor response.'
            )
        });
    }
});


// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(
    port,
    () => {
        console.log(
            `Server running on http://localhost:${port}`
        );
    }
);


// --------------------------------------------------
// GENERATE TEXT USING GROQ
// --------------------------------------------------

async function generateText(
    prompt,
    structured = false
) {

    const requestBody = {

        model: modelName,

        messages: [
            {
                role: 'user',
                content: prompt
            }
        ],

        temperature:
            structured
                ? 0.3
                : 0.7
    };


    // --------------------------------------------------
    // STRICT JSON MODE
    // ONLY USED FOR /analyze
    // --------------------------------------------------

if (structured) {

    requestBody.reasoning_format = 'hidden';

    requestBody.response_format = {
    type: 'json_schema',
    json_schema: {
        name: 'literature_analysis',
        strict: true,
        schema: {
            type: 'object',

            properties: {

                title: {
                    type: 'string'
                },

                summary: {
                    type: 'string'
                },

                whyItMatters: {
                    type: 'string'
                },

                themes: {
                    type: 'array',
                    items: {
                        type: 'string'
                    }
                },

characters: {
    type: 'array',
    items: {
        type: 'string'
    }
},
                discussionQuestions: {
                    type: 'array',
                    items: {
                        type: 'string'
                    }
                },

                studyTips: {
                    type: 'array',
                    items: {
                        type: 'string'
                    }
                }
            },

            required: [
                'title',
                'summary',
                'whyItMatters',
                'themes',
                'characters',
                'discussionQuestions',
                'studyTips'
            ],

            additionalProperties: false
        }
    }
};
}

    // --------------------------------------------------
    // CALL GROQ API
    // --------------------------------------------------

    const response = await fetch(
        groqApiUrl,
        {
            method: 'POST',

            headers: {
                'Content-Type':
                    'application/json',

                Authorization:
                    `Bearer ${apiKey}`
            },

            body: JSON.stringify(
                requestBody
            )
        }
    );


    const payload =
        await response
            .json()
            .catch(() => ({}));


    if (!response.ok) {

        throw buildProviderError(
            response.status,
            payload
        );
    }


    const content =
        payload?.choices?.[0]?.message?.content;


    if (!content) {

        throw new Error(
            'Groq returned an empty response.'
        );
    }


    return String(
        content
    ).trim();
}


// --------------------------------------------------
// PARSE ANALYSIS RESPONSE
// --------------------------------------------------

function parseAnalysisResponse(
    rawText,
    fallbackTitle
) {

    const cleaned =
        stripCodeFences(rawText);


    // --------------------------------------------------
    // FIRST ATTEMPT:
    // DIRECT JSON PARSE
    // --------------------------------------------------

    try {

        const parsed =
            JSON.parse(cleaned);

        return normalizeAnalysis(
            parsed,
            fallbackTitle
        );

    } catch (error) {

        console.warn(
            'Direct JSON parse failed. Trying JSON extraction.'
        );
    }


    // --------------------------------------------------
    // SECOND ATTEMPT:
    // EXTRACT JSON OBJECT
    // --------------------------------------------------

    try {

        const firstBrace =
            cleaned.indexOf('{');

        const lastBrace =
            cleaned.lastIndexOf('}');


        if (
            firstBrace !== -1 &&
            lastBrace !== -1 &&
            lastBrace > firstBrace
        ) {

            const jsonText =
                cleaned.substring(
                    firstBrace,
                    lastBrace + 1
                );


            const parsed =
                JSON.parse(jsonText);


            return normalizeAnalysis(
                parsed,
                fallbackTitle
            );
        }

    } catch (error) {

        console.warn(
            'JSON extraction failed. Using fallback parser.'
        );
    }


    // --------------------------------------------------
    // FINAL FALLBACK
    // --------------------------------------------------

    return fallbackAnalysisFromText(
        cleaned,
        fallbackTitle
    );
}


// --------------------------------------------------
// REMOVE MARKDOWN CODE FENCES
// --------------------------------------------------

function stripCodeFences(text) {

    return String(text || '')
        .replace(
            /^```json\s*/i,
            ''
        )
        .replace(
            /^```\s*/i,
            ''
        )
        .replace(
            /\s*```$/,
            ''
        )
        .trim();
}


// --------------------------------------------------
// NORMALIZE ANALYSIS
// --------------------------------------------------

function normalizeAnalysis(
    analysis,
    fallbackTitle
) {

    return {

        title:
            analysis?.title ||
            fallbackTitle,

        summary:
            analysis?.summary ||
            'Summary unavailable.',

        whyItMatters:
            analysis?.whyItMatters ||
            'Literary significance unavailable.',

        themes:
            normalizeTextArray(
                analysis?.themes
            ),

        characters:
            normalizeTextArray(
                analysis?.characters
            ),

        discussionQuestions:
            normalizeTextArray(
                analysis?.discussionQuestions
            ),

        studyTips:
            normalizeTextArray(
                analysis?.studyTips
            )
    };
}


function normalizeTextArray(value) {

    if (!Array.isArray(value)) {
        return [];
    }

    return value.map((item) => {

        if (typeof item === 'string') {
            return item;
        }

        if (item && typeof item === 'object') {

            if (item.name && item.role) {
                return `${item.name} — ${item.role}`;
            }

            if (item.name) {
                return String(item.name);
            }

            if (item.title && item.description) {
                return `${item.title} — ${item.description}`;
            }

            if (item.title) {
                return String(item.title);
            }

            if (item.question) {
                return String(item.question);
            }

            if (item.tip) {
                return String(item.tip);
            }

            return Object.values(item)
                .filter(
                    value =>
                        value !== null &&
                        value !== undefined
                )
                .map(value => String(value))
                .join(' — ');
        }

        return String(item);

    }).filter(Boolean);
}
// --------------------------------------------------
// FALLBACK ANALYSIS
// --------------------------------------------------

function fallbackAnalysisFromText(
    text,
    fallbackTitle
) {

    return {

        title:
            fallbackTitle,

        summary:
            text ||
            'Summary unavailable.',

        whyItMatters:
            'This text is significant for its themes, character development, and literary interpretation.',

        themes: [
            'Identity',
            'Conflict',
            'Society'
        ],

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


// --------------------------------------------------
// ENSURE ARRAY
// --------------------------------------------------

function ensureArray(value) {

    return Array.isArray(value)
        ? value
        : [];
}


// --------------------------------------------------
// DETECT FULL STORY REQUEST
// --------------------------------------------------

function asksForFullStory(
    prompt
) {

    const normalizedPrompt =
        String(prompt)
            .toLowerCase();


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

    ].some(
        phrase =>
            normalizedPrompt.includes(
                phrase
            )
    );
}


// --------------------------------------------------
// USER-FACING ERROR MESSAGE
// --------------------------------------------------

function getUserFacingErrorMessage(
    error,
    fallbackMessage
) {

    const rawMessage =
        String(
            error?.message || ''
        ).toLowerCase();


    if (

        rawMessage.includes('503') ||

        rawMessage.includes(
            'service unavailable'
        ) ||

        rawMessage.includes(
            'high demand'
        ) ||

        rawMessage.includes(
            'rate limit'
        ) ||

        rawMessage.includes(
            'too many requests'
        ) ||

        rawMessage.includes(
            'unavailable'
        )

    ) {

        return highTrafficMessage;
    }


    return (
        error?.message ||
        fallbackMessage
    );
}


// --------------------------------------------------
// BUILD GROQ PROVIDER ERROR
// --------------------------------------------------

function buildProviderError(
    status,
    payload
) {

    const providerMessage =

        payload?.error?.message ||

        payload?.detail ||

        payload?.message ||

        `Groq request failed with status ${status}.`;


    const error =
        new Error(
            providerMessage
        );


    error.status =
        status;

    error.payload =
        payload;


    return error;
}


// --------------------------------------------------
// LOAD ANALYSIS CACHE
// --------------------------------------------------

function loadAnalysisCache() {

    try {

        ensureCacheDirExists();


        if (
            !fs.existsSync(
                analysisCacheFile
            )
        ) {

            fs.writeFileSync(
                analysisCacheFile,
                '{}'
            );

            return {};
        }


        return JSON.parse(
            fs.readFileSync(
                analysisCacheFile,
                'utf8'
            )
        );

    } catch (error) {

        console.warn(
            'Could not load analysis cache:',
            error.message
        );

        return {};
    }
}


// --------------------------------------------------
// SAVE ANALYSIS TO CACHE
// --------------------------------------------------

function cacheAnalysis(
    cacheKey,
    analysis
) {

    const normalizedTitleKey =
        normalizeCacheKey(
            analysis?.title || ''
        );


    analysisCache[cacheKey] =
        analysis;


    if (normalizedTitleKey) {

        analysisCache[
            normalizedTitleKey
        ] = analysis;
    }


    try {

        ensureCacheDirExists();


        fs.writeFileSync(

            analysisCacheFile,

            JSON.stringify(
                analysisCache,
                null,
                2
            )

        );

    } catch (error) {

        console.warn(
            'Could not persist analysis cache:',
            error.message
        );
    }
}


// --------------------------------------------------
// ENSURE CACHE DIRECTORY
// --------------------------------------------------

function ensureCacheDirExists() {

    fs.mkdirSync(
        path.dirname(
            analysisCacheFile
        ),
        {
            recursive: true
        }
    );
}


// --------------------------------------------------
// NORMALIZE CACHE KEY
// --------------------------------------------------

function normalizeCacheKey(
    value
) {

    return String(
        value || ''
    )
        .trim()
        .toLowerCase();
}
