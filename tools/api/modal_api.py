from __future__ import annotations

import base64
import json
import os
import re
import time
from datetime import datetime, timezone
from typing import Any

import httpx
import modal
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from board import consume_rate_limit, find_duplicate_rank, insert_top, validate_run


COMMENTATOR_PROMPT = """You are Otto, a sarcastic but loving otter who sits in the middle of a downhill mountain bike trail with a laptop and does live race commentary.
Write ONE line reacting to the run described in the JSON below.
Rules:
- At most 22 words.
- Funny and specific: reference at most two of the stats.
- If otterHits > 0, use the word "ottified".
- If rank is 1, crown them. If crashes is 0, praise the clean run.
- PG only. No emojis, hashtags, quotation marks, or em dashes.
- Output only the line.
"""
ELEVENLABS_VOICE_ID = "TX3LPaxmHKxFdv7VOQHJ"
TOP_KEY = "top"
BEST_GHOST_KEY = "ghost:best"
DAILY_TTS_LIMIT = 80

app = modal.App("downhill-api")
board = modal.Dict.from_name("downhill-board", create_if_missing=True)
api_secret = modal.Secret.from_name("downhill-api")
image = modal.Image.debian_slim(python_version="3.12").pip_install("fastapi", "httpx").add_local_python_source("board")
web = FastAPI()
web.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def _top_entries() -> list[dict[str, Any]]:
    return list(board.get(TOP_KEY, []))


def _public_run(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": item["name"],
        "time": item["time"],
        "penalties": item["penalties"],
        "bonus": item.get("bonus", 0),
        "topSpeed": item["topSpeed"],
        "ts": item["ts"],
    }


@web.get("/leaderboard")
async def get_leaderboard() -> dict[str, Any]:
    ghost = board.get(BEST_GHOST_KEY)
    return {
        "top": [_public_run(item) for item in _top_entries()[:10]],
        "ghost": ghost,
    }


@web.post("/run")
async def post_run(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except Exception as error:
        raise HTTPException(status_code=400, detail="Invalid JSON") from error
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Run must be an object")
    try:
        run = validate_run(body)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",", 1)[0].strip() if forwarded else ""
    if not ip:
        ip = request.client.host if request.client else "unknown"
    if not consume_rate_limit(board, ip, time.time()):
        raise HTTPException(status_code=429, detail="Run limit reached")

    existing = _top_entries()
    duplicate = find_duplicate_rank(existing, run) is not None
    updated, rank = insert_top(existing, run, timestamp=time.time())
    if not duplicate:
        board.put(TOP_KEY, updated)
    if rank == 1 and not duplicate:
        board.put(BEST_GHOST_KEY, {
            "name": run["name"],
            "time": run["time"],
            "dt": run["ghost"]["dt"],
            "frames": run["ghost"]["frames"],
        })
    return {
        "rank": rank,
        "top": [_public_run(item) for item in updated[:10]],
    }


async def _commentary_text(stats: dict[str, Any]) -> str:
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="Commentary unavailable")
    payload = {
        "systemInstruction": {"parts": [{"text": COMMENTATOR_PROMPT}]},
        "contents": [{
            "role": "user",
            "parts": [{"text": json.dumps(stats, separators=(",", ":"))}],
        }],
        "generationConfig": {
            "temperature": 1.0,
            "maxOutputTokens": 60,
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.post(
                "https://generativelanguage.googleapis.com/v1beta/models/"
                "gemini-2.5-flash:generateContent",
                headers={"x-goog-api-key": key},
                json=payload,
            )
        response.raise_for_status()
        parts = response.json()["candidates"][0]["content"]["parts"]
        text = "".join(part.get("text", "") for part in parts)
    except Exception as error:
        raise HTTPException(status_code=503, detail="Commentary unavailable") from error
    text = re.sub(r'["\'“”‘’]', "", text).replace("—", "")
    return " ".join(text.split())[:160].rstrip()


async def _commentary_audio(text: str) -> str | None:
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        return None
    day = datetime.now(timezone.utc).date().isoformat()
    counter_key = f"tts:{day}"
    count = board.get(counter_key, 0)
    if not isinstance(count, int) or count >= DAILY_TTS_LIMIT:
        return None
    board.put(counter_key, count + 1)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}",
                headers={
                    "xi-api-key": key,
                    "Accept": "audio/mpeg",
                    "Content-Type": "application/json",
                },
                json={"text": text, "model_id": "eleven_flash_v2_5"},
            )
        response.raise_for_status()
    except Exception:
        return None
    return base64.b64encode(response.content).decode("ascii")


@web.post("/commentary")
async def post_commentary(body: dict[str, Any]) -> dict[str, Any]:
    stats = {
        key: body.get(key)
        for key in ("time", "penalties", "bonus", "topSpeed", "crashes", "otterHits", "maxAir", "rank")
    }
    try:
        text = await _commentary_text(stats)
    except HTTPException:
        raise
    audio = await _commentary_audio(text)
    return {"text": text, "audio": audio}


@app.function(
    image=image,
    secrets=[api_secret],
    min_containers=0,
)
@modal.asgi_app()
def serve() -> FastAPI:
    return web
