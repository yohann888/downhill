import asyncio
import json

from starlette.requests import Request

import modal_api


class MemoryBoard(dict):
    def put(self, key, value):
        self[key] = value


def _entry(index):
    return {
        "name": f"Rider{index}",
        "time": 40 + index,
        "penalties": 0,
        "bonus": 0,
        "topSpeed": 30,
        "ts": index,
    }


def _request(body):
    payload = json.dumps(body).encode()

    async def receive():
        return {"type": "http.request", "body": payload, "more_body": False}

    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/run",
            "headers": [(b"x-forwarded-for", b"192.0.2.1")],
            "client": ("127.0.0.1", 1234),
        },
        receive,
    )


def test_get_leaderboard_returns_up_to_top_size(monkeypatch):
    monkeypatch.setattr(modal_api, "board", MemoryBoard())
    modal_api.board[modal_api.TOP_KEY] = [_entry(index) for index in range(55)]

    result = asyncio.run(modal_api.get_leaderboard())

    assert len(result["top"]) == 50
    assert result["top"][0]["name"] == "RID"
    assert result["top"][-1]["name"] == "RID"


def test_post_run_returns_top_size(monkeypatch):
    board = MemoryBoard()
    board[modal_api.TOP_KEY] = [_entry(index) for index in range(50)]
    monkeypatch.setattr(modal_api, "board", board)
    run = {
        "name": "new",
        "time": 30,
        "penalties": 0,
        "bonus": 0,
        "topSpeed": 42,
        "crashes": 0,
        "otterHits": 0,
        "maxAir": 0,
        "ghost": {"dt": 0.1, "frames": [[0, 0, 0, 0, 0] for _ in range(300)]},
    }

    result = asyncio.run(modal_api.post_run(_request(run)))

    assert result["rank"] == 1
    assert len(result["top"]) == 50
    assert result["top"][0]["name"] == "NEW"


def test_get_leaderboard_clips_legacy_names_without_mutating_storage(monkeypatch):
    board = MemoryBoard()
    board[modal_api.TOP_KEY] = [{
        **_entry(0),
        "name": "Long Legacy Name",
    }]
    board[modal_api.BEST_GHOST_KEY] = {
        "name": "Long Ghost Name",
        "frames": [[0, 1, 2, 0, 0]],
        "dt": 0.1,
    }
    monkeypatch.setattr(modal_api, "board", board)

    result = asyncio.run(modal_api.get_leaderboard())

    assert result["top"][0]["name"] == "LON"
    assert result["ghost"]["name"] == "LON"
    assert board[modal_api.TOP_KEY][0]["name"] == "Long Legacy Name"
    assert board[modal_api.BEST_GHOST_KEY]["name"] == "Long Ghost Name"
