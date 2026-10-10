from fastapi import HTTPException
from google.cloud import texttospeech

from app.config import settings


def synthesize_speech(text: str) -> bytes:
    if not settings.google_cloud_project:
        raise HTTPException(
            status_code=503,
            detail="Text-to-speech is not configured. Set GOOGLE_CLOUD_PROJECT and Google credentials.",
        )
    client = texttospeech.TextToSpeechClient()
    response = client.synthesize_speech(
        request={
            "input": texttospeech.SynthesisInput(text=text),
            "voice": texttospeech.VoiceSelectionParams(
                language_code=settings.speech_language_code,
                ssml_gender=texttospeech.SsmlVoiceGender.NEUTRAL,
            ),
            "audio_config": texttospeech.AudioConfig(
                audio_encoding=texttospeech.AudioEncoding.MP3
            ),
        }
    )
    return response.audio_content
