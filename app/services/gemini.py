import json
from functools import lru_cache
from typing import Any

from fastapi import HTTPException
from google import genai
from google.genai import types

from app.config import settings


@lru_cache(maxsize=1)
def _client() -> genai.Client:
    if not settings.gemini_api_key:
        raise HTTPException(status_code=503, detail="Gemini is not configured. Set GEMINI_API_KEY.")
    return genai.Client(api_key=settings.gemini_api_key)


def opening_question(role: str, level: str) -> str:
    return f"Tell me about yourself and what interests you about working as a {level} {role}."


def evaluate_answer(role: str, level: str, question: str, answer: str, history: list[dict[str, str]]) -> dict[str, Any]:
    prompt = (
        "You are a fair technical interview evaluator. Assess the candidate's answer using the interview "
        "question, role, level, and previous conversation. Provide a score from 0 to 10, concise constructive "
        "feedback, and one relevant next interview question. Return only a JSON object with keys "
        '"score" (number), "feedback" (string), and "next_question" (string). '
        f"\nRole: {role}\nLevel: {level}\nQuestion: {question}\nAnswer: {answer}\n"
        f"Previous conversation: {json.dumps(history, ensure_ascii=False)}"
    )
    response = _client().models.generate_content(
        model=settings.gemini_model,
        contents=prompt,
        config=types.GenerateContentConfig(response_mime_type="application/json"),
    )
    if not response.text:
        raise HTTPException(status_code=502, detail="Gemini returned an empty evaluation.")
    try:
        result = json.loads(response.text)
        score = float(result["score"])
        feedback = str(result["feedback"]).strip()
        next_question = str(result["next_question"]).strip()
        if not 0 <= score <= 10 or not feedback or not next_question:
            raise ValueError("Evaluation fields are outside the expected range.")
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Gemini returned an invalid evaluation.") from exc
    return {"score": score, "feedback": feedback, "next_question": next_question}
