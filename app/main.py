from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import models  # noqa: F401
from app.config import settings
from app.database import Base, engine
from app.routes import auth, interviews, results, websocket


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
FRONTEND_DIST = FRONTEND_DIR / "dist"
app.include_router(auth.router)
app.include_router(interviews.router)
app.include_router(results.router)
app.include_router(websocket.router)
if (FRONTEND_DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="frontend-assets")


@app.get("/", include_in_schema=False)
def frontend() -> FileResponse:
    built_index = FRONTEND_DIST / "index.html"
    return FileResponse(built_index if built_index.is_file() else FRONTEND_DIR / "index.html")

@app.get("/api")
def home() -> dict[str, str]:
    return {"message": "Welcome to the Interview Management API!"}



