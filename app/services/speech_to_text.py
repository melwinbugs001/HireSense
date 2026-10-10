from fastapi import HTTPException
from google.cloud import speech

from app.config import settings


def transcribe_audio(audio: bytes, encoding: str, sample_rate_hertz: int) -> str:
    if not settings.google_cloud_project:
        raise HTTPException(
            status_code=503,
            detail="Speech-to-text is not configured. Set GOOGLE_CLOUD_PROJECT and Google credentials.",
        )
    try:
        audio_encoding = speech.RecognitionConfig.AudioEncoding[encoding]
    except KeyError as exc:
        raise HTTPException(status_code=422, detail="Unsupported audio encoding.") from exc
    client = speech.SpeechClient()
    response = client.recognize(
        request={
            "config": speech.RecognitionConfig(
                encoding=audio_encoding,
                sample_rate_hertz=sample_rate_hertz,
                language_code=settings.speech_language_code,
            ),
            "audio": speech.RecognitionAudio(content=audio),
        }
    )
    return " ".join(
        alternative.transcript
        for result in response.results
        if result.alternatives
        for alternative in result.alternatives[:1]
    ).strip()
