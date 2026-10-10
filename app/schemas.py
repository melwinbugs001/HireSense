from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=160, strip_whitespace=True)
    password: str = Field(min_length=8, max_length=128)


class UserRead(BaseModel):
    id: int
    email: EmailStr
    full_name: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class InterviewCreate(BaseModel):
    role: str = Field(min_length=2, max_length=160, strip_whitespace=True)
    level: Literal["junior", "mid", "medium", "senior"] = "mid"

    @field_validator("role")
    @classmethod
    def validate_role(cls, value: str) -> str:
        normalized = " ".join(value.split())
        generic_values = {
            "bar",
            "example",
            "foo",
            "job",
            "null",
            "role",
            "sample",
            "string",
            "test",
            "title",
            "undefined",
        }
        if (
            len(normalized) < 2
            or not any(character.isalnum() for character in normalized)
            or normalized.casefold() in generic_values
        ):
            raise ValueError("Enter a specific job role, such as Python Developer.")
        return normalized


class InterviewRead(BaseModel):
    id: int
    role: str
    level: str
    status: str
    created_at: datetime
    started_at: datetime | None
    ended_at: datetime | None
    model_config = ConfigDict(from_attributes=True)


class TurnRead(BaseModel):
    id: int
    speaker: str
    content: str
    score: float | None
    feedback: dict | None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class TranscriptRead(BaseModel):
    interview_id: int
    turns: list[TurnRead]


class ResultRead(BaseModel):
    interview_id: int
    status: str
    overall_score: float | None
    answer_count: int
    feedback: list[dict]


class PerformanceRead(BaseModel):
    interview_id: int
    answer_count: int
    average_score: float | None
    score_by_question: list[dict]
