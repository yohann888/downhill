import json
import math
from pathlib import Path

import pytest

from board import (
    _course_center_x,
    consume_slot,
    find_duplicate_rank,
    insert_top,
    quantize_ghost,
    validate_run,
)


class MemoryStore(dict):
    def put(self, key, value, skip_if_exists=False):
        if skip_if_exists and key in self:
            return False
        self[key] = value
        return True


def _path(count, *, start_z=-6, finish_z=-901):
    start_x = _course_center_x(start_z)
    finish_x = _course_center_x(finish_z)
    return [
        [
            start_x + (finish_x - start_x) * index / (count - 1),
            0,
            start_z + (finish_z - start_z) * index / (count - 1),
            0,
            0,
        ]
        for index in range(count)
    ]


def valid_run(**overrides):
    run = {
        "name": "AAA",
        "time": 30,
        "penalties": 2,
        "topSpeed": 42.5,
        "crashes": 1,
        "otterHits": 1,
        "maxAir": 1.4,
        "ghost": {"dt": 0.1, "frames": _path(280)},
    }
    run.update(overrides)
    return run


def test_validate_run_normalizes_initials_and_quantizes_ghost():
    body = valid_run(name=" ab9 ")
    body["ghost"]["frames"][0][1] = 1.234
    run = validate_run(body)

    assert run["name"] == "AB9"
    assert run["ghost"]["frames"][0] == [
        round(_course_center_x(-6), 2),
        1.23,
        -6.0,
        0.0,
        0.0,
    ]
    assert run["bonus"] == 0


def test_validate_run_includes_bonus_in_simulated_ghost_duration():
    run = validate_run(valid_run(
        bonus=2,
        ghost={"dt": 0.1, "frames": _path(300)},
    ))

    assert run["bonus"] == 2


def test_validate_run_accepts_real_client_fixture_unchanged():
    fixture_path = Path(__file__).parent / "fixtures" / "real_client_run.json"
    with fixture_path.open() as fixture_file:
        fixture = json.load(fixture_file)

    run = validate_run(fixture)

    assert run["ghost"] == fixture["ghost"]


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"name": "   "}, "name"),
        ({"name": "name-too-long1"}, "name"),
        ({"name": "ABCD"}, "name"),
        ({"name": "bad/name"}, "name"),
        ({"time": 20}, "time"),
        ({"time": 600}, "time"),
        ({"topSpeed": math.inf}, "topSpeed"),
        ({"maxAir": math.nan}, "maxAir"),
        ({"bonus": -0.1}, "bonus"),
        ({"bonus": 30}, "bonus"),
        ({"extra": math.nan}, "extra"),
        ({"crashes": 0.5}, "whole numbers"),
        (
            {"ghost": {"dt": 0.1, "frames": _path(100)}},
            "duration",
        ),
        (
            {
                "time": 20.01,
                "penalties": 0,
                "bonus": 0,
                "ghost": {"dt": 20.01, "frames": [_path(2)[0]]},
            },
            "ghost.dt must be 0.1",
        ),
        (
            {
                "ghost": {"dt": 0.1, "frames": [_path(2)[0]]},
            },
            "duration",
        ),
        (
            {
                "time": 20.5,
                "penalties": 0,
                "ghost": {
                    "dt": 0.1,
                    "frames": [[_course_center_x(-6), 0, -6, 0, 0] for _ in range(205)],
                },
            },
            "finish",
        ),
        (
            {
                "ghost": {"dt": 0.101, "frames": _path(280)},
            },
            "ghost.dt must be 0.1",
        ),
        (
            {
                "ghost": {"dt": 0.1, "frames": _path(280, finish_z=-500)},
            },
            "finish",
        ),
        (
            {
                "ghost": {"dt": 0.1, "frames": _path(280, start_z=-100)},
            },
            "start",
        ),
        (
            {
                "penalties": 29.99,
                "ghost": {"dt": 0.1, "frames": []},
            },
            "start",
        ),
    ],
)
def test_validate_run_rejects_invalid_values(overrides, message):
    with pytest.raises(ValueError, match=message):
        validate_run(valid_run(**overrides))


def test_validate_run_rejects_forward_jump_but_allows_backward_respawn():
    forward_jump = _path(280)
    forward_jump[140][2] = forward_jump[139][2] - 20
    with pytest.raises(ValueError, match="faster"):
        validate_run(valid_run(ghost={"dt": 0.1, "frames": forward_jump}))

    respawn_path = _path(280)
    respawn_index = 100
    respawn_path[respawn_index][2] = respawn_path[respawn_index - 1][2] + 110
    start_after_respawn = respawn_path[respawn_index][2]
    finish_z = respawn_path[-1][2]
    remaining_steps = len(respawn_path) - 1 - respawn_index
    for index in range(respawn_index + 1, len(respawn_path)):
        respawn_path[index][2] = start_after_respawn + (
            finish_z - start_after_respawn
        ) * (index - respawn_index) / remaining_steps

    run = validate_run(valid_run(ghost={"dt": 0.1, "frames": respawn_path}))

    backward_step = (
        run["ghost"]["frames"][respawn_index][2]
        - run["ghost"]["frames"][respawn_index - 1][2]
    )
    assert backward_step == pytest.approx(110)


def test_quantize_ghost_rejects_oversized_and_nonfinite_frames():
    with pytest.raises(ValueError, match="at most"):
        quantize_ghost({"dt": 0.1, "frames": [[0, 0, 0, 0, 0]] * 6001})
    with pytest.raises(ValueError, match="finite"):
        quantize_ghost({"dt": 0.1, "frames": [[0, 0, float("inf"), 0, 0]]})


def test_insert_top_sorts_by_time_caps_at_fifty_and_returns_rank():
    existing = [
        {"name": f"Rider{i}", "time": 25 + i, "penalties": 0, "topSpeed": 20, "ts": i}
        for i in range(50)
    ]
    top, rank = insert_top(existing, {"name": "Fast", "time": 21, "penalties": 0, "topSpeed": 40}, timestamp=100)

    assert len(top) == 50
    assert top[0]["name"] == "Fast"
    assert rank == 1

    top, rank = insert_top(top, {"name": "Slow", "time": 1000, "penalties": 0, "topSpeed": 10}, timestamp=101)
    assert rank is None
    assert all(item["name"] != "Slow" for item in top)


def test_insert_top_returns_existing_rank_for_duplicate_name_and_time():
    existing = [
        {"name": "Rider", "time": 29.5, "penalties": 0, "topSpeed": 40, "ts": 1},
        {"name": "Rider", "time": 30.0, "penalties": 2, "topSpeed": 42, "ts": 2},
    ]

    top, rank = insert_top(
        existing,
        {"name": "Rider", "time": 30.0, "penalties": 3, "topSpeed": 50},
        timestamp=100,
    )

    assert top == existing
    assert rank == 2


def test_find_duplicate_rank_keeps_one_tick_improvements():
    existing = [{"name": "YO", "time": 47.3083}]

    assert find_duplicate_rank(
        existing,
        {"name": "YO", "time": 47.3083 - 1 / 120},
    ) is None
    assert find_duplicate_rank(existing, {"name": "YO", "time": 47.3083}) == 1


def test_insert_top_accepts_legacy_entries_and_names():
    existing = [
        {
            "name": "legacy lowercase rider",
            "time": 31.0,
            "penalties": 1,
            "topSpeed": 40,
            "ts": 1,
        }
    ]

    top, rank = insert_top(
        existing,
        {"name": "New", "time": 30.0, "penalties": 0, "topSpeed": 42},
        timestamp=2,
    )

    assert rank == 1
    assert top[0]["name"] == "New"
    assert top[1] == existing[0]


def test_insert_top_keeps_same_name_with_different_time():
    existing = [
        {"name": "Rider", "time": 30.0, "penalties": 0, "topSpeed": 40, "ts": 1},
    ]

    top, rank = insert_top(
        existing,
        {"name": "Rider", "time": 30.5, "penalties": 0, "topSpeed": 42},
        timestamp=2,
    )

    assert len(top) == 2
    assert rank == 2
    assert top[1]["time"] == 30.5


def test_consume_slot_allows_exactly_the_limit():
    store = MemoryStore()
    for _ in range(3):
        assert consume_slot(store, "test", 3)
    assert not consume_slot(store, "test", 3)


@pytest.mark.parametrize("hint", ["x", -1, 8, True])
def test_consume_slot_ignores_garbage_hints_without_exceeding_limit(hint):
    store = MemoryStore({"test:n": hint})

    for _ in range(3):
        assert consume_slot(store, "test", 3)
    assert not consume_slot(store, "test", 3)


def test_consume_slot_handles_two_callers_with_the_same_hint():
    class RacingStore(dict):
        hint_reads = 0

        def get(self, key, default=None):
            if key == "test:n" and self.hint_reads < 2:
                self.hint_reads += 1
                return 0
            return super().get(key, default)

        def put(self, key, value, skip_if_exists=False):
            if skip_if_exists and key in self:
                return False
            self[key] = value
            return True

    store = RacingStore()

    assert consume_slot(store, "test", 2)
    assert consume_slot(store, "test", 2)
    assert store["test:0"] == 1
    assert store["test:1"] == 1
    assert not consume_slot(store, "test", 2)
