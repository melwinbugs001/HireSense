from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import Interview, InterviewTurn, User, utc_now
from app.schemas import InterviewCreate, InterviewRead
from app.services.gemini import opening_question


router = APIRouter(prefix="/interviews", tags=["Interviews"])


def owned_interview(db: Session, interview_id: int, user_id: int) -> Interview:
    interview = db.scalar(
        select(Interview).where(Interview.id == interview_id, Interview.owner_id == user_id)
    )
    if interview is None:
        raise HTTPException(status_code=404, detail="Interview not found.")
    return interview


@router.post("", response_model=InterviewRead, status_code=status.HTTP_201_CREATED)
def create_interview(
    payload: InterviewCreate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> Interview:
    interview = Interview(owner_id=user.id, role=payload.role.strip(), level=payload.level)
    db.add(interview)
    db.commit()
    db.refresh(interview)
    return interview


@router.get("", response_model=list[InterviewRead])
def list_interviews(
    db: Annotated[Session, Depends(get_db)], user: Annotated[User, Depends(get_current_user)]
) -> list[Interview]:
    return list(
        db.scalars(
            select(Interview).where(Interview.owner_id == user.id).order_by(Interview.created_at.desc())
        )
    )


@router.get("/{interview_id}", response_model=InterviewRead)
def get_interview(
    interview_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> Interview:
    return owned_interview(db, interview_id, user.id)


@router.delete("/{interview_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_interview(
    interview_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> Response:
    interview = owned_interview(db, interview_id, user.id)
    if interview.status == "active":
        raise HTTPException(status_code=409, detail="End an active interview before deleting it.")
    db.delete(interview)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{interview_id}/start", response_model=InterviewRead)
def start_interview(
    interview_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> Interview:
    interview = owned_interview(db, interview_id, user.id)
    if interview.status != "scheduled":
        raise HTTPException(status_code=409, detail="Only scheduled interviews can be started.")
    interview.status = "active"
    interview.started_at = utc_now()
    db.add(
        InterviewTurn(
            interview_id=interview.id,
            speaker="interviewer",
            content=opening_question(interview.role, interview.level),
        )
    )
    db.commit()
    db.refresh(interview)
    return interview


@router.post("/{interview_id}/end", response_model=InterviewRead)
def end_interview(
    interview_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> Interview:
    interview = owned_interview(db, interview_id, user.id)
    if interview.status != "active":
        raise HTTPException(status_code=409, detail="Only active interviews can be ended.")
    interview.status = "completed"
    interview.ended_at = utc_now()
    db.commit()
    db.refresh(interview)
    return interview
