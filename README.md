# HireSense | AI Interview API

FastAPI backend for authenticated, voice-enabled interview sessions. Interviews and transcripts are stored in SQLite by default. Gemini evaluates candidate answers and generates follow-up questions; Google Cloud Speech-to-Text and Text-to-Speech provide the voice path.

## Setup

Python 3.10 or newer is required.

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Set a private `SECRET_KEY` and `GEMINI_API_KEY` in `.env`. Generate a secret, for example, with:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Gemini evaluation requires `GEMINI_API_KEY`. Google Cloud Text-to-Speech is optional: if it is not configured or is unavailable, the browser app uses built-in speech synthesis when supported and keeps the live interview connected. To use server-side audio uploads for speech recognition, configure a Google Cloud project, enable the Speech-to-Text API, and set up Application Default Credentials (for example, `gcloud auth application-default login`). Set `GOOGLE_CLOUD_PROJECT` in `.env`.

## Run

```powershell
uvicorn app.main:app --reload
```

Open `http://127.0.0.1:8000` for HireSense or `http://127.0.0.1:8000/docs` for interactive API docs. The React and Vite app includes account registration and email/password sign-in, an interview dashboard, and live typed-answer practice.

For frontend development, keep the API running on port 8000 and start Vite in a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL at `http://127.0.0.1:5173`. Its development proxy forwards API and WebSocket requests to FastAPI on port 8000. To serve the production React build through FastAPI, run `npm run build` inside `frontend`, then start/restart the API; it serves `frontend/dist`. The **Speak** button uses browser speech recognition when available; spoken interviewer audio requires the configured Google Cloud Text-to-Speech service. Tables are created automatically on startup. Use HTTPS and a persistent database in production.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/register` | Register an account |
| POST | `/auth/login` | Get a bearer access token |
| GET | `/auth/me` | Current account |
| POST | `/interviews` | Create an interview |
| GET | `/interviews` | List the current user's interviews |
| GET | `/interviews/{id}` | Get an interview |
| DELETE | `/interviews/{id}` | Delete a non-active interview and its transcript |
| POST | `/interviews/{id}/start` | Start and create the opening question |
| POST | `/interviews/{id}/end` | End an active interview |
| WS | `/ws/interviews/{id}?token={access_token}` | Live interview conversation |
| GET | `/interviews/{id}/transcript` | Ordered conversation turns |
| GET | `/interviews/{id}/result` | Overall score and feedback |
| GET | `/interviews/{id}/performance` | Per-answer scores |

All HTTP interview and results routes require `Authorization: Bearer <access_token>`. In Swagger UI, click **Authorize** and enter the account email in `username` and its password; the OAuth2 flow exchanges these form fields at `/auth/token`. The JSON login endpoint `/auth/login` remains available to application clients. The WebSocket authenticates with the `token` query parameter because browser WebSocket clients generally cannot set an Authorization header.

Interview roles are trimmed and normalized, must contain at least two letters or numbers, and reject generic placeholders such as `string`, `test`, and `sample`. The dashboard can delete scheduled or completed sessions; deleting a session also deletes its transcript and results. Active sessions must be ended first.

### WebSocket protocol

Connect after starting an interview. The server sends the current question as `{"type":"question","text":"..."}`.

Submit typed answers:

```json
{"type":"answer","text":"I have five years of Python experience..."}
```

Or send a complete base64-encoded audio clip:

```json
{
  "type": "audio",
  "audio_base64": "<base64 audio>",
  "encoding": "WEBM_OPUS",
  "sample_rate_hertz": 48000
}
```

Supported `encoding` values are the Google Speech-to-Text `RecognitionConfig.AudioEncoding` names. The server responds with a transcript (for audio), then an evaluation containing score, feedback, and the next question, followed by base64 MP3 audio. A client can send `{"type":"end"}` to close its socket; use `POST /interviews/{id}/end` to finish and persist the interview's completed status.
