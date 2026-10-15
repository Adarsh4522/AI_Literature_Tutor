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
    'openai/gpt-oss-120b';

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

 
const systemPrompt = `
You are LitWise, an expert literature tutor for school and college students.

Determine whether the user's input refers to an AUTHOR or a LITERARY WORK.

If the input is an AUTHOR:
- Generate a profile about that author, not one of their books.
- The title field must contain the author's full name.
- The summary must cover the author's background, literary career, writing style, and major contributions.
- whyItMatters must explain the author's literary influence and significance.
- themes must describe recurring themes across the author's writing.
- characters must list notable works by the author, with brief descriptions.
- discussionQuestions and studyTips must relate to studying the author's life and literature.

If the input is a BOOK, NOVEL, PLAY, POEM, or SHORT STORY:
- Analyze that specific work.
- The title field must contain the work's title.
- Include its plot, literary significance, themes, characters, discussion questions, and study tips as appropriate.

Never replace an author's name with the title of one of their works.
If the input is ambiguous, make the most reasonable interpretation.

Return ONLY a valid JSON object matching the required schema.
Do not include markdown fences or commentary.
Escape double quotes inside JSON string values.
All arrays must contain plain text strings.
`.trim();


        const userPrompt = `Analyze the literary work or author "${bookName}". Output ONLY the valid JSON object.`;

        const rawText = await generateText(
            userPrompt,
            false,
            systemPrompt
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


        const systemPrompt = `You are LitWise, a helpful and friendly literature tutor for students.
CRITICAL INSTRUCTIONS:
- Answer ONLY what the student asked in simple, natural, conversational paragraphs.
- Provide ONLY plain text.
- NEVER use markdown bold/italic asterisks (no ** or *), NEVER use markdown headers (#), NEVER use markdown tables (|), and NEVER use bullet points.
- NEVER add extra unrequested sections such as "Why It Matters", "Study Tips", "Summary", or quizzes.`;

        const userPrompt = `Book: ${bookTitle || 'Not specified'}
Student Question: ${prompt}

${
    wantsFullStory
        ? 'Retell the full story clearly from beginning to end in plain text paragraphs (around 350-500 words).'
        : 'Explain this directly, clearly, and simply in plain text (under 180 words).'
}`;


        const reply = await generateText(
            userPrompt,
            false,
            systemPrompt
        );


        return res.json({
            reply: cleanChatReply(reply)
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
// CLEAN CHAT REPLY SANITIZER
// --------------------------------------------------

function cleanChatReply(text) {
    if (!text || typeof text !== 'string') return '';
    let cleaned = text;

    // Remove markdown table headers & separator lines
    cleaned = cleaned.replace(/^\|.*\|$/gm, '');
    cleaned = cleaned.replace(/\|[^\n\r]*\|/g, '');

    // Remove unwanted auto-generated meta sections at the end
    cleaned = cleaned.replace(/(Why (He|She|It|They) Matters?|Quick Study Tips?|Study Tips?|Key Traits?|Literary Significance):?[\s\S]*$/i, '');

    // Remove all markdown bold/italic asterisks, underscores, backticks, hashes
    cleaned = cleaned.replace(/\*{1,3}/g, '');
    cleaned = cleaned.replace(/_{1,3}/g, '');
    cleaned = cleaned.replace(/`{1,3}/g, '');
    cleaned = cleaned.replace(/^#+\s*/gm, '');

    // Clean up dangling dashes, pipes, and whitespace
    cleaned = cleaned.replace(/^[ \t]*[-–—|•][ \t]*/gm, '');
    cleaned = cleaned.replace(/\n\s*\n\s*\n+/g, '\n\n');

    return cleaned.trim();
}


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
    structured = false,
    systemPrompt = null
) {

    const messages = [];

    if (systemPrompt) {
        messages.push({
            role: 'system',
            content: systemPrompt
        });
    }

    messages.push({
        role: 'user',
        content: prompt
    });

  
const requestBody = {
    model: modelName,
    messages,
    temperature: structured ? 0.2 : 0.5,
    max_completion_tokens: structured ? 8192 : 2048
};

    if (structured) {
        requestBody.response_format = {
            type: 'json_object'
        };
    }

    try {
        const response = await fetch(
            groqApiUrl,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`
                },
                body: JSON.stringify(requestBody)
            }
        );

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
            // If Groq validation failed but returned failed_generation, salvage the text
            const failedGen =
                payload?.error?.failed_generation ||
                payload?.failed_generation;

            if (failedGen && typeof failedGen === 'string' && failedGen.trim().length > 0) {
                console.warn('Groq reported json failure, but provided failed_generation. Salvaging content.');
                return failedGen.trim();
            }

            // If structured generation failed with 400, retry once in plain text mode
            if (structured) {
                console.warn(`Structured generation failed (${response.status}). Retrying without response_format...`);
                return await generateText(prompt, false, systemPrompt);
            }

            throw buildProviderError(
                response.status,
                payload
            );
        }

        const content = payload?.choices?.[0]?.message?.content;

        if (!content) {
            throw new Error('Groq returned an empty response.');
        }

        return String(content).trim();
    } catch (err) {
        if (structured && !err.isRetry) {
            console.warn('Structured call encountered error. Retrying in plain mode...', err.message);
            const retryErr = new Error();
            retryErr.isRetry = true;
            try {
                return await generateText(prompt, false, systemPrompt);
            } catch (retryError) {
                throw err;
            }
        }
        throw err;
    }
}


// --------------------------------------------------
// PARSE ANALYSIS RESPONSE
// --------------------------------------------------

function parseAnalysisResponse(
    rawText,
    fallbackTitle
) {

    const cleaned = stripCodeFences(rawText);

    // 1. Direct JSON parse
    try {
        const parsed = JSON.parse(cleaned);
        return normalizeAnalysis(parsed, fallbackTitle);
    } catch (error) {
        // Continue
    }

    // 2. Extract substring between first '{' and last '}'
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');

    if (
        firstBrace !== -1 &&
        lastBrace !== -1 &&
        lastBrace > firstBrace
    ) {
        const jsonCandidate = cleaned.substring(
            firstBrace,
            lastBrace + 1
        );

        try {
            const parsed = JSON.parse(jsonCandidate);
            return normalizeAnalysis(parsed, fallbackTitle);
        } catch (error) {
            // Attempt auto-repair
            try {
                const repaired = jsonCandidate
                    .replace(/,\s*([}\]])/g, '$1')
                    .replace(/[\u0000-\u001F]+/g, (match) =>
                        match === '\n' ? '\\n' : match === '\t' ? '\\t' : ''
                    );
                const parsed = JSON.parse(repaired);
                return normalizeAnalysis(parsed, fallbackTitle);
            } catch (repairError) {
                // Continue to regex extractor
            }
        }
    }

    // 3. Regex-based field extraction
    try {
        const extracted = extractFieldsWithRegex(cleaned);
        if (extracted && (extracted.summary || extracted.title)) {
            return normalizeAnalysis(extracted, fallbackTitle);
        }
    } catch (e) {
        console.warn('Regex extraction failed:', e.message);
    }

    // 4. Final fallback
    return fallbackAnalysisFromText(
        cleaned,
        fallbackTitle
    );
}


// --------------------------------------------------
// REGEX-BASED FIELD EXTRACTION
// --------------------------------------------------


function extractFieldsWithRegex(text) {
    try {
        const cleaned = stripCodeFences(text);

        // First, try parsing the complete JSON response.
        try {
            const parsed = JSON.parse(cleaned);

            if (parsed && typeof parsed === 'object') {
                return {
                    title: parsed.title ?? null,
                    summary: parsed.summary ?? null,
                    whyItMatters: parsed.whyItMatters ?? null,
                    themes: Array.isArray(parsed.themes) ? parsed.themes : [],
                    characters: Array.isArray(parsed.characters) ? parsed.characters : [],
                    discussionQuestions: Array.isArray(parsed.discussionQuestions)
                        ? parsed.discussionQuestions
                        : [],
                    studyTips: Array.isArray(parsed.studyTips) ? parsed.studyTips : []
                };
            }
        } catch (_) {
            // Continue to field-level extraction if the JSON is incomplete.
        }

        // Recover individual fields from a partially malformed JSON response.
        const extractStringField = (field) => {
            const match = cleaned.match(
                new RegExp(
                    `"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`,
                    'i'
                )
            );

            if (!match) return null;

            try {
                return JSON.parse(`"${match[1]}"`);
            } catch (_) {
                return match[1]
                    .replace(/\\"/g, '"')
                    .replace(/\\n/g, '\n')
                    .trim();
            }
        };

        const extractArrayField = (field) => {
            const match = cleaned.match(
                new RegExp(`"${field}"\\s*:\\s*\\[([\\s\\S]*?)\\]`, 'i')
            );

            if (!match) return [];

            const items = [];
            const itemRegex = /"((?:\\.|[^"\\])*)"/g;
            let itemMatch;

            while ((itemMatch = itemRegex.exec(match[1])) !== null) {
                try {
                    items.push(JSON.parse(`"${itemMatch[1]}"`));
                } catch (_) {
                    items.push(itemMatch[1].replace(/\\"/g, '"'));
                }
            }

            return items;
        };

        return {
            title: extractStringField('title'),
            summary: extractStringField('summary'),
            whyItMatters: extractStringField('whyItMatters'),
            themes: extractArrayField('themes'),
            characters: extractArrayField('characters'),
            discussionQuestions: extractArrayField('discussionQuestions'),
            studyTips: extractArrayField('studyTips')
        };
    } catch (error) {
        console.warn('Field extraction failed:', error.message);
        return {};
    }
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
            /\s*```$/i,
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
    typeof analysis?.summary === 'string' &&
    analysis.summary.trim().length > 0
        ? analysis.summary.trim()
        : 'A summary could not be generated. Please try analyzing this title again.',

whyItMatters:
    typeof analysis?.whyItMatters === 'string' &&
    analysis.whyItMatters.trim().length > 0
        ? analysis.whyItMatters.trim()
        : 'Literary significance could not be generated. Please try again.',

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


function cacheAnalysis(cacheKey, analysis) {
    // Do not cache incomplete analyses.
    const summary = analysis?.summary?.trim();
    const significance = analysis?.whyItMatters?.trim();

    if (
        !summary ||
        summary === 'Summary unavailable.' ||
        summary === 'A summary could not be generated. Please try analyzing this title again.' ||
        !significance ||
        significance === 'Literary significance unavailable.' ||
        significance === 'Literary significance could not be generated. Please try again.'
    ) {
        console.warn(
            `Skipping incomplete analysis cache entry: ${analysis?.title || cacheKey}`
        );
        return;
    }

    const normalizedTitleKey = normalizeCacheKey(analysis?.title || '');

    analysisCache[cacheKey] = analysis;

    if (normalizedTitleKey) {
        analysisCache[normalizedTitleKey] = analysis;
    }

    try {
        ensureCacheDirExists();

        fs.writeFileSync(
            analysisCacheFile,
            JSON.stringify(analysisCache, null, 2)
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
