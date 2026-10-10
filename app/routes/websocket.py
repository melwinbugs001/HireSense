import base64
import binascii
import asyncio
import logging

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from google.api_core.exceptions import GoogleAPICallError
from google.genai.errors import APIError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.database import SessionLocal
from app.models import InterviewTurn
from app.routes.interviews import owned_interview
from app.services.gemini import evaluate_answer
from app.services.speech_to_text import transcribe_audio
from app.services.text_to_speech import synthesize_speech


router = APIRouter(tags=["Live interview"])
logger = logging.getLogger(__name__)


@router.websocket("/ws/interviews/{interview_id}")
async def interview_socket(websocket: WebSocket, interview_id: int) -> None:
    await websocket.accept()
    db = SessionLocal()
    try:
        token = websocket.query_params.get("token")
        if not token:
            await websocket.close(code=1008, reason="A bearer token is required.")
            return
        from jose import JWTError, jwt

        from app.auth import ALGORITHM
        from app.config import settings
        from app.models import User

        if not settings.secret_key:
            await websocket.close(code=1011, reason="Authentication is not configured.")
            return
        try:
            user_id = int(jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])["sub"])
        except (JWTError, KeyError, TypeError, ValueError):
            await websocket.close(code=1008, reason="Invalid or expired bearer token.")
            return
        interview = owned_interview(db, interview_id, user_id)
        if interview.status != "active":
            await websocket.close(code=1008, reason="Interview is not active.")
            return
        latest_question = db.scalar(
            select(InterviewTurn)
            .where(InterviewTurn.interview_id == interview_id, InterviewTurn.speaker == "interviewer")
            .order_by(InterviewTurn.id.desc())
        )
        if latest_question:
            await websocket.send_json({"type": "question", "text": latest_question.content})

        while True:
            message = await websocket.receive_json()
            if not isinstance(message, dict):
                await websocket.send_json({"type": "error", "detail": "Expected a JSON object."})
                continue
            kind = message.get("type")
            if kind == "end":
                break
            if kind == "answer":
                answer = message.get("text")
                if not isinstance(answer, str) or not answer.strip():
                    await websocket.send_json({"type": "error", "detail": "Answer text must not be empty."})
                    continue
                answer = answer.strip()
            elif kind == "audio":
                try:
                    audio = base64.b64decode(message["audio_base64"], validate=True)
                    sample_rate_hertz = int(message["sample_rate_hertz"])
                    encoding = str(message["encoding"])
                    if not audio or len(audio) > 10_000_000 or not 8_000 <= sample_rate_hertz <= 48_000:
                        raise ValueError("Audio must be non-empty, at most 10 MB, and 8-48 kHz.")
                except (KeyError, TypeError, ValueError, binascii.Error):
                    await websocket.send_json(
                        {"type": "error", "detail": "Invalid audio payload or unsupported sample rate."}
                    )
                    continue
                answer = await asyncio.to_thread(
                    transcribe_audio, audio, encoding, sample_rate_hertz
                )
                if not answer:
                    await websocket.send_json({"type": "error", "detail": "No speech was recognized."})
                    continue
                await websocket.send_json({"type": "transcript", "text": answer})
            else:
                await websocket.send_json(
                    {"type": "error", "detail": 'Message type must be "answer", "audio", or "end".'}
                )
                continue

            question = db.scalar(
                select(InterviewTurn)
                .where(InterviewTurn.interview_id == interview_id, InterviewTurn.speaker == "interviewer")
                .order_by(InterviewTurn.id.desc())
            )
            history = [
                {"speaker": turn.speaker, "content": turn.content}
                for turn in db.scalars(
                    select(InterviewTurn)
                    .where(InterviewTurn.interview_id == interview_id)
                    .order_by(InterviewTurn.id)
                )
            ]
            try:
                evaluation = await asyncio.to_thread(
                    evaluate_answer,
                    interview.role,
                    interview.level,
                    question.content if question else "",
                    answer,
                    history,
                )
            except APIError as exc:
                if exc.code == 503:
                    logger.warning(
                        "Gemini is temporarily unavailable for interview %s",
                        interview_id,
                    )
                    await websocket.send_json(
                        {
                            "type": "error",
                            "detail": (
                                "Gemini is temporarily busy. Your answer was not submitted. "
                                "Please wait a moment and try sending it again."
                            ),
                            "retryable": True,
                        }
                    )
                    continue
                raise
            candidate_turn = InterviewTurn(
                interview_id=interview_id,
                speaker="candidate",
                content=answer,
                score=evaluation["score"],
                feedback={"text": evaluation["feedback"]},
            )
            next_turn = InterviewTurn(
                interview_id=interview_id,
                speaker="interviewer",
                content=evaluation["next_question"],
            )
            db.add_all([candidate_turn, next_turn])
            db.commit()
            await websocket.send_json(
                {
                    "type": "evaluation",
                    "transcript": answer,
                    "score": evaluation["score"],
                    "feedback": evaluation["feedback"],
                    "next_question": evaluation["next_question"],
                }
            )
            try:
                audio_content = await asyncio.to_thread(
                    synthesize_speech, evaluation["next_question"]
                )
            except HTTPException as exc:
                logger.warning(
                    "Text-to-speech is unavailable for interview %s: %s",
                    interview_id,
                    exc.detail,
                )
                await websocket.send_json(
                    {
                        "type": "audio_unavailable",
                        "detail": exc.detail,
                        "text": evaluation["next_question"],
                    }
                )
                continue
            except GoogleAPICallError:
                logger.warning(
                    "Google Text-to-Speech request failed for interview %s",
                    interview_id,
                    exc_info=True,
                )
                await websocket.send_json(
                    {
                        "type": "audio_unavailable",
                        "detail": "Google Text-to-Speech is temporarily unavailable.",
                        "text": evaluation["next_question"],
                    }
                )
                continue
            await websocket.send_json(
                {
                    "type": "audio",
                    "content_type": "audio/mpeg",
                    "audio_base64": base64.b64encode(audio_content).decode("ascii"),
                    "text": evaluation["next_question"],
                }
            )
    except WebSocketDisconnect:
        pass
    except (HTTPException, APIError, GoogleAPICallError, SQLAlchemyError) as exc:
        if isinstance(exc, HTTPException):
            logger.warning(
                "Live interview request failed for interview %s: %s",
                interview_id,
                exc.detail,
            )
            detail = exc.detail
        else:
            logger.exception("Live interview processing failed for interview %s", interview_id)
            detail = "Live interview processing failed."
        await websocket.send_json({"type": "error", "detail": detail})
        await websocket.close(code=1011, reason="Live interview processing failed.")
    finally:
        db.close()
