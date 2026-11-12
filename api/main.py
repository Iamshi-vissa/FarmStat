"""
FarmStat web API + web app.

Run:   python -m uvicorn api.main:app --port 8000
Open:  http://localhost:8000        (serves the built React app from web/dist)
Docs:  http://localhost:8000/docs   (interactive API documentation)
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .service import FarmData

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "web" / "dist"
STATE: dict = {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    STATE["data"] = FarmData()   # first start ~1 minute, then cached on disk
    yield


app = FastAPI(title="FarmStat API", version="2.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["GET"], allow_headers=["*"])


def data() -> FarmData:
    return STATE["data"]


def weekly_crop(crop: str) -> str:
    if crop not in {c["id"] for c in data().meta()["crops"] if c["kind"] == "weekly"}:
        raise HTTPException(404, f"Unknown weekly crop '{crop}'.")
    return crop


@app.get("/api/meta")
def meta():
    return data().meta()


@app.get("/api/mandis")
def mandis(crop: str, state: str):
    rows = data().mandis(weekly_crop(crop), state)
    if not rows:
        raise HTTPException(404, f"No active mandis for {crop} in {state}.")
    return rows


@app.get("/api/series")
def series(crop: str, state: str, market: str, weeks: int = Query(104, ge=8, le=520)):
    out = data().series(weekly_crop(crop), state, market, weeks)
    if out is None:
        raise HTTPException(404, f"No data for {crop} at {market}, {state}.")
    return out


@app.get("/api/national")
def national(crop: str, variety: str | None = None):
    return data().national(weekly_crop(crop), variety)


@app.get("/api/cashew")
def cashew():
    return data().cashew()


@app.get("/api/sugarcane")
def sugarcane():
    return data().sugarcane()


@app.get("/api/accuracy")
def accuracy():
    return data().accuracy()


if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
