"""
FarmStat web API + web app.

Run:   python -m uvicorn api.main:app --port 8000
Open:  http://localhost:8000        (serves the built React app from web/dist)
Docs:  http://localhost:8000/docs   (interactive API documentation)

On Vercel the root index.py imports this app.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import livefeed
from .service import FarmData

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "web" / "dist"
STATE: dict = {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    data()   # load at start-up so the first request is quick
    yield


app = FastAPI(title="FarmStat API", version="2.1.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=800, compresslevel=6)   # JSON shrinks ~5-8x
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["GET"], allow_headers=["*"])


@app.middleware("http")
async def cache_headers(request, call_next):
    """Hashed web-app files never change, so browsers keep them for a year; data is cached for an hour."""
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/assets/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif path.startswith("/api/live") and response.status_code == 200:
        response.headers.setdefault("Cache-Control", "public, max-age=600, stale-while-revalidate=3600")
    elif path.startswith("/api/") and response.status_code == 200:
        response.headers.setdefault("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400")
    else:
        response.headers["Cache-Control"] = "no-cache"
    return response


def data() -> FarmData:
    # loaded on first use too, for hosts that skip start-up events
    if "data" not in STATE:
        STATE["data"] = FarmData()
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


@app.get("/api/overview")
def overview(crop: str):
    """India-wide picture for a weekly crop: median price and trend, states, biggest expected moves, top prices."""
    out = data().overview(weekly_crop(crop))
    if out is None:
        raise HTTPException(404, f"No data for {crop}.")
    return out


@app.get("/api/index")
def index():
    """All active mandi series (crop, state, market, district, latest price) for search across India."""
    return data().index()


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


@app.get("/api/live")
def live(crop: str, state: str, market: str):
    """Latest daily prices this mandi reported (from the daily data.gov.in fetch stored in Supabase)."""
    # only names FarmStat knows reach Supabase, so arbitrary input can't fill the cache or shape the query
    if not data().has_series(weekly_crop(crop), state, market):
        raise HTTPException(404, f"No data for {crop} at {market}, {state}.")
    return livefeed.mandi(crop, state, market)


@app.get("/api/live/status")
def live_status():
    return livefeed.status()


@app.get("/api/accuracy")
def accuracy():
    return data().accuracy()


if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
