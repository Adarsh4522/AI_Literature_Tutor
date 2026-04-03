const analyzeBtn = document.getElementById('analyzeBtn');
const bookInput = document.getElementById('bookInput');
const analysisDashboard = document.getElementById('analysisDashboard');
const chatSection = document.getElementById('chatSection');
const statusText = document.getElementById('statusText');
const quickPrompts = document.getElementById('quickPrompts');

const bookTitleDisplay = document.getElementById('bookTitleDisplay');
const themeTags = document.getElementById('themeTags');
const bookSummary = document.getElementById('bookSummary');
const bookImportance = document.getElementById('bookImportance');
const characterList = document.getElementById('characterList');
const discussionList = document.getElementById('discussionList');
const studyTipsList = document.getElementById('studyTipsList');
const chatSubtitle = document.getElementById('chatSubtitle');

const chatWindow = document.getElementById('chatWindow');
const chatInput = document.getElementById('chatInput');
const sendMsgBtn = document.getElementById('sendMsgBtn');

let currentBook = '';
let currentAnalysis = null;

analyzeBtn.addEventListener('click', handleAnalyzeRequest);
bookInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        handleAnalyzeRequest();
    }
});

sendMsgBtn.addEventListener('click', handleSendMessage);
chatInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        handleSendMessage();
    }
});

quickPrompts.addEventListener('click', (event) => {
    const chip = event.target.closest('.prompt-chip');
    if (!chip) {
        return;
    }

    bookInput.value = chip.dataset.book;
    handleAnalyzeRequest();
});

async function handleAnalyzeRequest() {
    const query = bookInput.value.trim();
    if (!query) {
        updateStatus('Enter a book title or author to begin.');
        return;
    }

    currentBook = query;
    currentAnalysis = null;

    toggleAnalyzeState(true);
    analysisDashboard.classList.remove('hidden');
    chatSection.classList.remove('hidden');

    bookTitleDisplay.textContent = `Analyzing: ${query}`;
    bookSummary.textContent = 'Building a literary overview...';
    bookImportance.textContent = 'Connecting the text to its larger literary ideas...';
    themeTags.innerHTML = '';
    characterList.innerHTML = '';
    discussionList.innerHTML = '';
    studyTipsList.innerHTML = '';
    resetChatForBook(query);
    updateStatus(`Analyzing "${query}" with LitWise...`);

    try {
        const data = await fetchBookAnalysis(query);
        currentAnalysis = data;
        renderAnalysis(data);
        updateStatus(`Analysis ready for "${data.title}". You can now ask follow-up questions.`);
    } catch (error) {
        bookSummary.textContent = `Error: ${error.message}`;
        bookImportance.textContent = 'The analysis could not be generated right now.';
        updateStatus('Analysis failed. Check the backend server and API key, then try again.');
        console.error(error);
    } finally {
        toggleAnalyzeState(false);
    }
}

async function fetchBookAnalysis(bookName) {
    const response = await fetch('/analyze', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ bookName })
    });

    const payload = await response.json();

    if (!response.ok) {
        throw new Error(payload.error || 'Failed to fetch analysis from server');
    }

    return payload;
}

function renderAnalysis(data) {
    currentBook = data.title;
    bookTitleDisplay.textContent = data.title;
    bookSummary.textContent = data.summary;
    bookImportance.textContent = data.whyItMatters;
    themeTags.innerHTML = data.themes.map((theme) => `<span class="tag">${escapeHtml(theme)}</span>`).join('');
    characterList.innerHTML = renderList(data.characters);
    discussionList.innerHTML = renderList(data.discussionQuestions);
    studyTipsList.innerHTML = renderList(data.studyTips);
    chatSubtitle.textContent = `Discussing ${data.title}. Ask deeper questions about themes, context, symbols, or essay ideas.`;
}

async function handleSendMessage() {
    const text = chatInput.value.trim();
    if (!text) {
        return;
    }

    appendMessage(text, 'user-msg');
    chatInput.value = '';

    setChatBusy(true);

    try {
        const response = await fetchChatResponse(text);
        appendMessage(response, 'tutor-msg');
    } catch (error) {
        appendMessage('Sorry, I could not respond just now. Please check the server and try again.', 'tutor-msg');
        console.error(error);
    } finally {
        setChatBusy(false);
        chatInput.focus();
    }
}

async function fetchChatResponse(prompt) {
    const response = await fetch('/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            prompt,
            bookTitle: currentBook,
            analysis: currentAnalysis
        })
    });

    const payload = await response.json();

    if (!response.ok) {
        throw new Error(payload.error || 'Failed to fetch chat response');
    }

    return payload.reply;
}

function appendMessage(text, className) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${className}`;
    msgDiv.innerHTML = `<p>${escapeHtml(text)}</p>`;
    chatWindow.appendChild(msgDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

function renderList(items) {
    return items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
}

function resetChatForBook(bookName) {
    chatWindow.innerHTML = '';
    appendMessage(`We are now focusing on ${bookName}. Ask about plot, character motivations, themes, symbols, quotations, or exam revision ideas.`, 'tutor-msg');
}

function toggleAnalyzeState(isLoading) {
    analyzeBtn.disabled = isLoading;
    analyzeBtn.textContent = isLoading ? 'Analyzing...' : 'Analyze';
}

function setChatBusy(isBusy) {
    chatInput.disabled = isBusy;
    sendMsgBtn.disabled = isBusy;
    sendMsgBtn.textContent = isBusy ? 'Thinking...' : 'Send';
}

function updateStatus(message) {
    statusText.textContent = message;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
