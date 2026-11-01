from __future__ import annotations

import base64
import ipaddress
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
from pydantic import BaseModel, ConfigDict, Field, StrictFloat, StrictInt, ValidationError

from board import (
    COMMENTARY_GLOBAL_DAY,
    COMMENTARY_PER_IP_HOUR,
    RUNS_GLOBAL_HOUR,
    RUNS_PER_IP_HOUR,
    TOP_SIZE,
    TTS_GLOBAL_DAY,
    TTS_PER_IP_DAY,
    consume_slot,
    find_duplicate_rank,
    insert_top,
    validate_run,
)


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
TOP_KEY = "top:v2"
BEST_GHOST_KEY = "ghost:best:v2"
COMMENTARY_FIELDS = ("time", "penalties", "bonus", "topSpeed", "crashes", "otterHits", "maxAir", "rank")


class CommentaryStats(BaseModel):
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)

    time: StrictFloat | StrictInt = Field(gt=20, lt=600)
    penalties: StrictFloat | StrictInt | None = Field(default=None, ge=-1e6, le=1e6)
    bonus: StrictFloat | StrictInt | None = Field(default=None, ge=-1e6, le=1e6)
    topSpeed: StrictFloat | StrictInt | None = Field(default=None, ge=-1e6, le=1e6)
    crashes: StrictFloat | StrictInt | None = Field(default=None, ge=-1e6, le=1e6)
    otterHits: StrictFloat | StrictInt | None = Field(default=None, ge=-1e6, le=1e6)
    maxAir: StrictFloat | StrictInt | None = Field(default=None, ge=-1e6, le=1e6)
    rank: StrictInt | None = Field(default=None, ge=1, le=10000)

app = modal.App("downhill-api")
board = modal.Dict.from_name("downhill-board", create_if_missing=True)
api_secret = modal.Secret.from_name("downhill-api")
image = modal.Image.debian_slim(python_version="3.12").pip_install("fastapi", "httpx", "pydantic").add_local_python_source("board")
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
        "name": str(item["name"]).upper()[:3],
        "time": item["time"],
        "penalties": item["penalties"],
        "bonus": item.get("bonus", 0),
        "topSpeed": item["topSpeed"],
        "ts": item["ts"],
    }


def _client_ip(request: Request) -> str:
    client_host = request.client.host if request.client else None
    try:
        address = ipaddress.ip_address(client_host)
    except ValueError:
        return "unknown"
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped is not None:
            return str(address.ipv4_mapped)
        network = ipaddress.ip_network(f"{address}/48", strict=False)
        return f"{network.network_address}/48"
    return str(address)


@web.get("/leaderboard")
async def get_leaderboard() -> dict[str, Any]:
    ghost = board.get(BEST_GHOST_KEY)
    return {
        "top": [_public_run(item) for item in _top_entries()[:TOP_SIZE]],
        "ghost": {
            **ghost,
            "name": str(ghost.get("name", "")).upper()[:3],
        } if isinstance(ghost, dict) else ghost,
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

    existing = _top_entries()
    duplicate = find_duplicate_rank(existing, run) is not None

    if not duplicate:
        ip = _client_ip(request)
        now = time.time()
        hour = int(now // 3600)
        if not consume_slot(board, f"rl:run:{ip}:{hour}", RUNS_PER_IP_HOUR) or not consume_slot(
            board, f"rl:run:all:{hour}", RUNS_GLOBAL_HOUR
        ):
            raise HTTPException(status_code=429, detail="Run limit reached")

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
        "top": [_public_run(item) for item in updated[:TOP_SIZE]],
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


async def _commentary_audio(text: str, ip: str) -> str | None:
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        return None
    day = datetime.now(timezone.utc).date().isoformat()
    if not consume_slot(board, f"rl:tts:{ip}:{day}", TTS_PER_IP_DAY) or not consume_slot(
        board, f"rl:tts:{day}", TTS_GLOBAL_DAY
    ):
        return None
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
async def post_commentary(request: Request) -> dict[str, Any]:
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            if int(content_length) > 4096:
                raise HTTPException(status_code=413, detail="Request body too large")
        except ValueError:
            pass

    body_bytes = bytearray()
    async for chunk in request.stream():
        body_bytes.extend(chunk)
        if len(body_bytes) > 4096:
            raise HTTPException(status_code=413, detail="Request body too large")
    try:
        body = json.loads(body_bytes)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise HTTPException(status_code=400, detail="Invalid JSON") from error
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid JSON")
    try:
        model = CommentaryStats.model_validate(body)
    except ValidationError as error:
        raise HTTPException(status_code=400, detail="Invalid commentary request") from error

    ip = _client_ip(request)
    now = time.time()
    hour = int(now // 3600)
    day = datetime.now(timezone.utc).date().isoformat()
    if not consume_slot(board, f"rl:cm:{ip}:{hour}", COMMENTARY_PER_IP_HOUR) or not consume_slot(
        board, f"rl:gemini:{day}", COMMENTARY_GLOBAL_DAY
    ):
        raise HTTPException(status_code=429, detail="Commentary limit reached")

    model_stats = model.model_dump()
    stats = {key: model_stats[key] for key in COMMENTARY_FIELDS}
    try:
        text = await _commentary_text(stats)
    except HTTPException:
        raise
    audio = await _commentary_audio(text, ip)
    return {"text": text, "audio": audio}


@app.function(
    image=image,
    secrets=[api_secret],
    min_containers=0,
    max_containers=4,
    scaledown_window=300,
)
@modal.concurrent(max_inputs=20)
@modal.asgi_app()
def serve() -> FastAPI:
    return web
