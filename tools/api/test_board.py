import math

import pytest

from board import consume_rate_limit, insert_top, quantize_ghost, validate_run


def valid_run(**overrides):
    run = {
        "name": "Rider",
        "time": 30,
        "penalties": 2,
        "topSpeed": 42.5,
        "crashes": 1,
        "otterHits": 1,
        "maxAir": 1.4,
        "ghost": {
            "dt": 0.1,
            "frames": [[0, 1.234, 2, 0, 0] for _ in range(280)],
        },
    }
    run.update(overrides)
    return run


def test_validate_run_trims_name_and_quantizes_ghost():
    run = validate_run(valid_run(name=" Rider "))

    assert run["name"] == "Rider"
    assert run["ghost"]["frames"][0] == [0.0, 1.23, 2.0, 0.0, 0.0]


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"name": "   "}, "name"),
        ({"name": "name-too-long1"}, "name"),
        ({"name": "bad/name"}, "name"),
        ({"time": 20}, "time"),
        ({"time": 600}, "time"),
        ({"topSpeed": math.inf}, "topSpeed"),
        ({"maxAir": math.nan}, "maxAir"),
        ({"extra": math.nan}, "extra"),
        ({"crashes": 0.5}, "whole numbers"),
        (
            {"ghost": {"dt": 0.1, "frames": [[0, 0, 0, 0, 0] for _ in range(100)]}},
            "duration",
        ),
    ],
)
def test_validate_run_rejects_invalid_values(overrides, message):
    with pytest.raises(ValueError, match=message):
        validate_run(valid_run(**overrides))


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
        {"name": "Rider", "time": 30.0 + 0.5e-6, "penalties": 3, "topSpeed": 50},
        timestamp=100,
    )

    assert top == existing
    assert rank == 2


def test_insert_top_keeps_same_name_with_different_time():
    existing = [
        {"name": "Rider", "time": 30.0, "penalties": 0, "topSpeed": 40, "ts": 1},
    ]

    top, rank = insert_top(
        existing,
        {"name": "Rider", "time": 31.0, "penalties": 0, "topSpeed": 42},
        timestamp=2,
    )

    assert len(top) == 2
    assert rank == 2
    assert top[1]["time"] == 31.0


def test_rate_limit_allows_thirty_runs_per_ip_per_hour():
    store = {}
    for _ in range(30):
        assert consume_rate_limit(store, "192.0.2.1", 7200)
    assert not consume_rate_limit(store, "192.0.2.1", 7200)
    assert consume_rate_limit(store, "192.0.2.1", 10800)
    assert consume_rate_limit(store, "192.0.2.2", 7200)
