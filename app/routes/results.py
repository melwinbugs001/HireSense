from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import InterviewTurn, User
from app.routes.interviews import owned_interview
from app.schemas import PerformanceRead, ResultRead, TranscriptRead


router = APIRouter(prefix="/interviews", tags=["Results"])


@router.get("/{interview_id}/transcript", response_model=TranscriptRead)
def transcript(
    interview_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> TranscriptRead:
    owned_interview(db, interview_id, user.id)
    turns = list(
        db.scalars(
            select(InterviewTurn)
            .where(InterviewTurn.interview_id == interview_id)
            .order_by(InterviewTurn.id)
        )
    )
    return TranscriptRead(interview_id=interview_id, turns=turns)


@router.get("/{interview_id}/result", response_model=ResultRead)
def result(
    interview_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> ResultRead:
    interview = owned_interview(db, interview_id, user.id)
    answers = list(
        db.scalars(
            select(InterviewTurn)
            .where(
                InterviewTurn.interview_id == interview_id,
                InterviewTurn.speaker == "candidate",
            )
            .order_by(InterviewTurn.id)
        )
    )
    scores = [turn.score for turn in answers if turn.score is not None]
    return ResultRead(
        interview_id=interview_id,
        status=interview.status,
        overall_score=round(sum(scores) / len(scores), 2) if scores else None,
        answer_count=len(answers),
        feedback=[
            {"turn_id": turn.id, "feedback": (turn.feedback or {}).get("text"), "score": turn.score}
            for turn in answers
        ],
    )


@router.get("/{interview_id}/performance", response_model=PerformanceRead)
def performance(
    interview_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> PerformanceRead:
    owned_interview(db, interview_id, user.id)
    turns = list(
        db.scalars(
            select(InterviewTurn)
            .where(
                InterviewTurn.interview_id == interview_id,
                InterviewTurn.speaker == "candidate",
            )
            .order_by(InterviewTurn.id)
        )
    )
    scores = [turn.score for turn in turns if turn.score is not None]
    return PerformanceRead(
        interview_id=interview_id,
        answer_count=len(turns),
        average_score=round(sum(scores) / len(scores), 2) if scores else None,
        score_by_question=[
            {
                "turn_id": turn.id,
                "score": turn.score,
                "feedback": (turn.feedback or {}).get("text"),
            }
            for turn in turns
        ],
    )
