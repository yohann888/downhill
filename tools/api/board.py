from __future__ import annotations

import math
import re
from collections.abc import Mapping, Sequence
from typing import Any


MAX_FRAMES = 6000
TOP_SIZE = 50
RUNS_PER_IP_HOUR = 10
IPV6_SITE_MULTIPLIER = 10
GHOST_DT = 0.1
START_Z = -6.0
START_RADIUS = 5.0
FINISH_Z = -900.0
COURSE_LENGTH = -FINISH_Z
CHECKPOINT_SPACING = 150.0
RESPAWN_RADIUS = 3.0
FINISH_SLACK = 10.0
MAX_FORWARD_STEP = 5.0
RUNS_GLOBAL_HOUR = 1000
COMMENTARY_PER_IP_HOUR = 20
COMMENTARY_GLOBAL_DAY = 5000
TTS_PER_IP_DAY = 3
TTS_GLOBAL_DAY = 80
_NAME_PATTERN = re.compile(r"[A-Z0-9]{1,3}\Z")
_RUN_NUMBER_FIELDS = ("time", "penalties", "bonus", "topSpeed", "crashes", "otterHits", "maxAir")


def _course_center_x(z: float) -> float:
    return (
        18 * math.sin(z / 90)
        + 9 * math.sin(z / 37 + 1.3)
        + 4 * math.sin(z / 17 + 0.4)
    )


def _near_checkpoint(frame: Sequence[float]) -> bool:
    checkpoint_z = -CHECKPOINT_SPACING
    while checkpoint_z >= -COURSE_LENGTH:
        if (
            math.hypot(
                frame[0] - _course_center_x(checkpoint_z),
                frame[2] - checkpoint_z,
            )
            <= RESPAWN_RADIUS
        ):
            return True
        checkpoint_z -= CHECKPOINT_SPACING
    return False


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
    if abs(dt - GHOST_DT) > 1e-9:
        raise ValueError("ghost.dt must be 0.1")
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
    return {"dt": GHOST_DT, "frames": quantized_frames}


def _check_ghost_path(frames: Sequence[Sequence[float]]) -> None:
    if not frames:
        raise ValueError("ghost must start at the course start")
    first = frames[0]
    if (
        math.hypot(first[0] - _course_center_x(START_Z), first[2] - START_Z)
        > START_RADIUS
    ):
        raise ValueError("ghost must start at the course start")
    if frames[-1][2] > FINISH_Z + FINISH_SLACK:
        raise ValueError("ghost must reach the finish")
    furthest_z = first[2]
    for previous, current in zip(frames, frames[1:]):
        if (
            previous[2] - current[2] > MAX_FORWARD_STEP + 1e-9
            and (
                not _near_checkpoint(current)
                or current[2] < furthest_z - RESPAWN_RADIUS
            )
        ):
            raise ValueError("ghost moves faster than the bike can")
        furthest_z = min(furthest_z, current[2])


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
    expected_frames = expected_duration / GHOST_DT
    if abs(len(ghost["frames"]) - expected_frames) > 2 + 0.01 * expected_frames:
        raise ValueError("ghost duration must match run time")
    _check_ghost_path(ghost["frames"])

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


def consume_slot(store: Any, key: str, limit: int) -> bool:
    hint = store.get(f"{key}:n", 0)
    start = (
        hint
        if isinstance(hint, int) and not isinstance(hint, bool) and 0 <= hint <= limit
        else 0
    )
    for slot in range(start, limit):
        if store.put(f"{key}:{slot}", 1, skip_if_exists=True):
            store.put(f"{key}:n", slot + 1)
            return True
    return False
