# LitWise

LitWise is an AI-powered literature tutor that helps students explore books, novels, plays, poems, and authors through instant literary analysis and guided discussion.

Users can enter a text like `Hamlet`, `1984`, or `To Kill a Mockingbird` and get:
- a student-friendly summary
- why the text matters
- major themes
- key characters
- discussion questions
- study tips

It also includes a discussion section where readers can ask follow-up questions, request a fuller story explanation, and get contextual literary help.

## Live Demo

- App: [https://litwise.itsadarsh.site](https://litwise.itsadarsh.site)

## Features

- AI-powered literary analysis from a single prompt
- Student-friendly summaries and explanations
- Theme, character, and discussion-question generation
- Interactive discussion/chat section
- Longer full-story response when the user asks for the entire plot
- Persistent analysis caching for repeated book titles
- Friendly high-traffic error handling
- Dockerized deployment
- Custom subdomain with HTTPS

## Tech Stack

- Frontend: [HTML5](https://developer.mozilla.org/en-US/docs/Web/HTML), [CSS3](https://developer.mozilla.org/en-US/docs/Web/CSS), [JavaScript](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
- Backend: [Node.js](https://nodejs.org/en), [Express.js](https://expressjs.com/)
- AI Provider: [Groq Cloud](https://console.groq.com/), [Groq API](https://console.groq.com/docs/overview)
- Environment Config: [dotenv](https://www.npmjs.com/package/dotenv)
- Containerization: [Docker](https://www.docker.com/), [Docker Compose](https://docs.docker.com/compose/)
- Reverse Proxy / Domain Management: [Nginx Proxy Manager](https://nginxproxymanager.com/)
- Domain / DNS: [Hostinger](https://www.hostinger.com/)
- Version Control: [Git](https://git-scm.com/), [GitHub](https://github.com/)

## How It Works

1. The user enters a book, novel, poem, play, or author name.
2. The frontend sends a request to the backend route `/analyze`.
3. The backend checks whether that title already exists in the analysis cache.
4. If cached, LitWise returns the saved result immediately.
5. If not cached, the backend sends the prompt to the Groq API.
6. Groq returns the generated literary response.
7. The backend formats the result and sends it back to the frontend.
8. The user can then ask follow-up questions in the discussion section through `/chat`.

## Project Structure

```text
AI Literature Tutor/
├── backend/
│   ├── cache/
│   ├── .env
│   ├── package.json
│   └── server.js
├── app.js
├── index.html
├── styles.css
├── docker-compose.yml
├── dockerfile
└── README.md
```

## Environment Variables

Create `backend/.env` with:

```env
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=llama-3.1-8b-instant
PORT=5000
```

Optional:

```env
GROQ_API_URL=https://api.groq.com/openai/v1/chat/completions
```

## Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/Adarsh4522/AI_Literature_Tutor
cd "AI Literature Tutor"
```

### 2. Install backend dependencies

```bash
cd backend
npm install
```

### 3. Add your environment variables

Create `backend/.env` and add your Groq API key.

### 4. Run the backend

```bash
node server.js
```

### 5. Open the app

Open:

```text
http://localhost:5000
```

## Docker Setup

### Build and run with Docker Compose

```bash
docker compose up -d --build
```

### View logs

```bash
docker compose logs -f
```

### Stop containers

```bash
docker compose down
```

## Docker Compose Services

The project uses two services in `docker-compose.yml`:

- `litwise`
  Runs the main Node.js application on port `5000`
- `nginx-proxy-manager`
  Provides GUI-based reverse proxy and SSL/domain management on ports `80`, `81`, and `443`

## Deployment

LitWise is deployed on a cloud VM and connected to a custom subdomain:

- Subdomain: [https://litwise.itsadarsh.site](https://litwise.itsadarsh.site)

Deployment flow:
- Hostinger DNS points `litwise.itsadarsh.site` to the VM IP
- Docker Compose runs the LitWise app and Nginx Proxy Manager
- Nginx Proxy Manager forwards public traffic to the app
- HTTPS is enabled through SSL

## Caching

LitWise includes a persistent backend cache for analysis responses.

- The first request for a title uses the AI provider
- Repeated requests for the same normalized title use cached data
- Cache is stored in `backend/cache`
- This helps reduce API usage and improves response time

## API Routes

### `POST /analyze`

Generates or returns cached literary analysis for a book or author.

Request body:

```json
{
  "bookName": "Hamlet"
}
```

### `POST /chat`

Generates a follow-up discussion response based on the current book and analysis context.

Request body:

```json
{
  "prompt": "Who is Hamlet?",
  "bookTitle": "Hamlet",
  "analysis": {}
}
```

## Prompt Behavior

- LitWise returns structured literary analysis in JSON format
- The discussion section usually gives concise answers
- If the user asks for the `whole story`, `full plot`, or `complete story`, LitWise gives a longer spoiler-aware response

## Error Handling

The backend returns friendly messages for common provider issues.

Example:

```text
LitWise is experiencing high AI traffic. Please try again in a few seconds.
```

## Use Cases

- Literature revision
- Quick summary generation
- Theme and character understanding
- Classroom discussion preparation
- Exam-oriented study help

## Future Improvements

- fallback AI providers
- richer caching and preloaded texts
- user authentication
- teacher dashboard
- multilingual support
- analytics and progress tracking

## Author

- Adarsh

## License

This project is for educational and portfolio use.
