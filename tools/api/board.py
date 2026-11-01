from __future__ import annotations

import math
import re
from collections.abc import Mapping, Sequence
from typing import Any


MAX_FRAMES = 6000
TOP_SIZE = 50
RUNS_PER_IP_HOUR = 30
_NAME_PATTERN = re.compile(r"[A-Z0-9]{1,3}\Z")
_RUN_NUMBER_FIELDS = ("time", "penalties", "bonus", "topSpeed", "crashes", "otterHits", "maxAir")


def _finite_number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} must be a finite number")
    try:
        number = float(value)
    except (OverflowError, ValueError) as error:
        raise ValueError(f"{field} must be a finite number") from error
    if not math.isfinite(number):
        raise ValueError(f"{field} must be a finite number")
    return number


def _validate_finite_tree(value: Any, field: str = "run") -> None:
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return
    if isinstance(value, (int, float)):
        _finite_number(value, field)
    elif isinstance(value, Mapping):
        for key, item in value.items():
            _validate_finite_tree(item, str(key))
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        for item in value:
            _validate_finite_tree(item, field)


def quantize_ghost(ghost: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(ghost, Mapping):
        raise ValueError("ghost must be an object")
    dt = _finite_number(ghost.get("dt"), "ghost.dt")
    if dt <= 0:
        raise ValueError("ghost.dt must be positive")
    frames = ghost.get("frames")
    if not isinstance(frames, Sequence) or isinstance(frames, (str, bytes)):
        raise ValueError("ghost.frames must be an array")
    if len(frames) > MAX_FRAMES:
        raise ValueError(f"ghost.frames must contain at most {MAX_FRAMES} frames")

    quantized_frames: list[list[float]] = []
    for index, frame in enumerate(frames):
        if not isinstance(frame, Sequence) or isinstance(frame, (str, bytes)) or len(frame) != 5:
            raise ValueError(f"ghost.frames[{index}] must contain five numbers")
        quantized_frames.append(
            [round(_finite_number(value, f"ghost.frames[{index}]"), 2) for value in frame]
        )
    return {"dt": dt, "frames": quantized_frames}


def validate_run(body: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(body, Mapping):
        raise ValueError("run must be an object")
    _validate_finite_tree(body)

    raw_name = body.get("name")
    if not isinstance(raw_name, str):
        raise ValueError("name must be 1 to 3 letters or digits")
    name = raw_name.strip().upper()
    if not _NAME_PATTERN.fullmatch(name):
        raise ValueError("name must be 1 to 3 letters or digits")

    values = {
        field: _finite_number(body.get(field, 0 if field == "bonus" else None), field)
        for field in _RUN_NUMBER_FIELDS
    }
    if not 20 < values["time"] < 600:
        raise ValueError("time must be between 20 and 600 seconds")
    if values["penalties"] < 0 or values["penalties"] >= values["time"]:
        raise ValueError("penalties must be nonnegative and less than time")
    if values["bonus"] < 0 or values["bonus"] >= values["time"]:
        raise ValueError("bonus must be nonnegative and less than time")
    if any(values[field] < 0 for field in ("topSpeed", "crashes", "otterHits", "maxAir")):
        raise ValueError("run statistics must be nonnegative")
    if not values["crashes"].is_integer() or not values["otterHits"].is_integer():
        raise ValueError("crashes and otterHits must be whole numbers")

    ghost = quantize_ghost(body.get("ghost"))
    expected_duration = values["time"] - values["penalties"] + values["bonus"]
    recorded_duration = len(ghost["frames"]) * ghost["dt"]
    if not 0.8 * expected_duration <= recorded_duration <= 1.2 * expected_duration:
        raise ValueError("ghost duration must be within 20 percent of run time")

    return {
        "name": name,
        **values,
        "crashes": int(values["crashes"]),
        "otterHits": int(values["otterHits"]),
        "ghost": ghost,
    }


def insert_top(
    existing: Sequence[Mapping[str, Any]],
    run: Mapping[str, Any],
    *,
    timestamp: float,
) -> tuple[list[dict[str, Any]], int | None]:
    entries = [dict(item) for item in existing]
    duplicate_rank = find_duplicate_rank(entries, run)
    if duplicate_rank is not None:
        return entries, duplicate_rank

    entry = {
        "name": run["name"],
        "time": float(run["time"]),
        "penalties": float(run["penalties"]),
        "bonus": float(run.get("bonus", 0)),
        "topSpeed": float(run["topSpeed"]),
        "ts": float(timestamp),
    }
    entries.append(entry)
    entries.sort(key=lambda item: (float(item["time"]), float(item.get("ts", 0))))
    top = entries[:TOP_SIZE]
    rank = next((index + 1 for index, item in enumerate(top) if item is entry), None)
    return top, rank


def find_duplicate_rank(
    existing: Sequence[Mapping[str, Any]],
    run: Mapping[str, Any],
) -> int | None:
    for index, item in enumerate(existing):
        if (
            item.get("name") == run["name"]
            and abs(float(item["time"]) - float(run["time"])) < 1e-6
        ):
            return index + 1
    return None


def consume_rate_limit(store: Any, ip: str, now: float) -> bool:
    key = f"rl:{ip}:{int(now // 3600)}"
    count = store.get(key, 0)
    if isinstance(count, bool) or not isinstance(count, int) or count >= RUNS_PER_IP_HOUR:
        return False
    next_count = count + 1
    if hasattr(store, "put"):
        store.put(key, next_count)
    else:
        store[key] = next_count
    return True
