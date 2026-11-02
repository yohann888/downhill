import asyncio
import json
from pathlib import Path

import pytest
from fastapi import HTTPException
from starlette.requests import Request

import modal_api
from board import _course_center_x


class MemoryBoard(dict):
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


def _entry(index):
    return {
        "name": f"Rider{index}",
        "time": 40 + index,
        "penalties": 0,
        "bonus": 0,
        "topSpeed": 30,
        "ts": index,
    }


def _request(body, *, path="/run", headers=None, client=("127.0.0.1", 1234)):
    payload = json.dumps(body).encode()

    async def receive():
        return {"type": "http.request", "body": payload, "more_body": False}

    request_headers = {"x-forwarded-for": "192.0.2.1"}
    request_headers.update(headers or {})
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "headers": [(key.lower().encode(), value.encode()) for key, value in request_headers.items()],
            "client": client,
        },
        receive,
    )


def _run_payload(time=30):
    return {
        "name": "AAA",
        "time": time,
        "penalties": 0,
        "bonus": 0,
        "topSpeed": 42,
        "crashes": 0,
        "otterHits": 0,
        "maxAir": 0,
        "ghost": {"dt": 0.1, "frames": _path(round(time * 10))},
    }


def _commentary_payload(**overrides):
    return {
        "name": "AAA",
        "time": 30.5,
        "penalties": 0.5,
        "bonus": 1.2,
        "topSpeed": 42,
        "crashes": 0,
        "otterHits": 1,
        "maxAir": 3.5,
        "rank": None,
        **overrides,
    }


def _stub_commentary(monkeypatch):
    async def commentary_text(stats):
        return "Nice run"

    async def commentary_audio(text, buckets):
        return None

    monkeypatch.setattr(modal_api, "_commentary_text", commentary_text)
    monkeypatch.setattr(modal_api, "_commentary_audio", commentary_audio)


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
    run = {**_run_payload(), "name": "new"}

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


def test_get_leaderboard_serves_legacy_records_without_mutating_storage(monkeypatch):
    board = MemoryBoard()
    legacy_entries = [
        {
            "name": "legacy lower-case long name",
            "time": 40,
            "penalties": 1,
            "topSpeed": 30,
            "ts": 1,
        }
    ]
    legacy_ghost = {
        "name": "legacy",
        "dt": 20.0,
        "frames": [[0, 0, 0, 0, 0]],
    }
    board[modal_api.TOP_KEY] = legacy_entries
    board[modal_api.BEST_GHOST_KEY] = legacy_ghost
    monkeypatch.setattr(modal_api, "board", board)

    result = asyncio.run(modal_api.get_leaderboard())

    assert result["top"][0]["name"] == "LEG"
    assert result["ghost"]["name"] == "LEG"
    assert result["ghost"]["dt"] == 20.0
    assert result["ghost"]["frames"] == [[0, 0, 0, 0, 0]]
    assert board[modal_api.TOP_KEY] == legacy_entries
    assert board[modal_api.BEST_GHOST_KEY] == legacy_ghost


def test_post_run_accepts_real_fixture_with_legacy_entries(monkeypatch):
    fixture_path = Path(__file__).parent / "fixtures" / "real_client_run.json"
    with fixture_path.open() as fixture_file:
        run = json.load(fixture_file)
    board = MemoryBoard()
    board[modal_api.TOP_KEY] = [{
        "name": "legacy",
        "time": 60,
        "penalties": 0,
        "topSpeed": 30,
        "ts": 1,
    }]
    monkeypatch.setattr(modal_api, "board", board)

    result = asyncio.run(modal_api.post_run(_request(run)))

    assert result["rank"] == 1
    assert result["top"][0]["name"] == "YO"
    assert board[modal_api.BEST_GHOST_KEY] == {
        "name": "YO",
        "time": run["time"],
        "dt": run["ghost"]["dt"],
        "frames": run["ghost"]["frames"],
    }


@pytest.mark.parametrize(
    ("client", "expected"),
    [
        (("192.0.2.8", 1234), ["192.0.2.8"]),
        (("::ffff:192.0.2.8", 1234), ["192.0.2.8"]),
        (("2001:db8:1234:5678::1", 1234), [
            "2001:db8:1234:5678::/64",
            "2001:db8:1234::/48",
        ]),
        (("not-an-ip", 1234), ["unknown"]),
        (None, ["unknown"]),
    ],
)
def test_client_buckets_normalize_request_client_only(client, expected):
    request = _request({}, client=client, headers={"x-forwarded-for": "203.0.113.77"})

    assert modal_api._client_buckets(request) == expected


def test_client_buckets_ipv6_layers():
    first = _request({}, client=("2001:db8:1234:1::1", 1234))
    same_64 = _request({}, client=("2001:db8:1234:1::2", 1234))
    other_64 = _request({}, client=("2001:db8:1234:2::1", 1234))
    ipv4 = _request({}, client=("192.0.2.8", 1234))
    mapped_ipv4 = _request({}, client=("::ffff:192.0.2.8", 1234))

    first_buckets = modal_api._client_buckets(first)
    assert first_buckets == [
        "2001:db8:1234:1::/64",
        "2001:db8:1234::/48",
    ]
    assert modal_api._client_buckets(same_64)[0] == first_buckets[0]
    assert modal_api._client_buckets(other_64)[0] != first_buckets[0]
    assert modal_api._client_buckets(other_64)[1] == first_buckets[1]
    assert modal_api._client_buckets(ipv4) == ["192.0.2.8"]
    assert modal_api._client_buckets(mapped_ipv4) == ["192.0.2.8"]


def test_post_run_limits_client_ip_ignoring_forwarded_headers(monkeypatch):
    board = MemoryBoard()
    monkeypatch.setattr(modal_api, "board", board)

    for index in range(modal_api.RUNS_PER_IP_HOUR):
        asyncio.run(modal_api.post_run(_request(
            _run_payload(30 + index * 0.02),
            headers={"x-forwarded-for": f"192.0.2.{index + 1}"},
            client=("198.51.100.5", 1234),
        )))

    with pytest.raises(HTTPException) as error:
        asyncio.run(modal_api.post_run(_request(
            _run_payload(30.6),
            headers={"x-forwarded-for": "203.0.113.99"},
            client=("198.51.100.5", 1234),
        )))
    assert error.value.status_code == 429
    assert error.value.detail == "Run limit reached"


def test_run_limit_per_64_does_not_block_neighbour_64(monkeypatch):
    board = MemoryBoard()
    monkeypatch.setattr(modal_api, "board", board)
    monkeypatch.setattr(modal_api, "RUNS_PER_IP_HOUR", 1)
    first_64 = ("2001:db8:1234:1::1", 1234)
    neighbour_64 = ("2001:db8:1234:2::1", 1234)
    third_64 = ("2001:db8:1234:3::1", 1234)
    fourth_64 = ("2001:db8:1234:4::1", 1234)

    asyncio.run(modal_api.post_run(_request(_run_payload(30), client=first_64)))
    with pytest.raises(HTTPException) as error:
        asyncio.run(modal_api.post_run(_request(_run_payload(31), client=first_64)))
    assert error.value.status_code == 429

    result = asyncio.run(modal_api.post_run(_request(_run_payload(32), client=neighbour_64)))
    assert any(entry["time"] == 32 for entry in result["top"])
    asyncio.run(modal_api.post_run(_request(_run_payload(33), client=third_64)))

    with pytest.raises(HTTPException) as error:
        asyncio.run(modal_api.post_run(_request(_run_payload(34), client=fourth_64)))
    assert error.value.status_code == 429


def test_post_run_enforces_global_limit(monkeypatch):
    monkeypatch.setattr(modal_api, "board", MemoryBoard())
    monkeypatch.setattr(modal_api, "RUNS_GLOBAL_HOUR", 2)

    for index in range(2):
        asyncio.run(modal_api.post_run(_request(
            _run_payload(30 + index),
            client=(f"198.51.100.{index + 1}", 1234),
        )))
    with pytest.raises(HTTPException) as error:
        asyncio.run(modal_api.post_run(_request(
            _run_payload(32),
            client=("198.51.100.3", 1234),
        )))
    assert error.value.status_code == 429


def test_duplicate_run_does_not_consume_another_slot(monkeypatch):
    monkeypatch.setattr(modal_api, "board", MemoryBoard())
    monkeypatch.setattr(modal_api, "RUNS_PER_IP_HOUR", 1)
    run = _run_payload()

    asyncio.run(modal_api.post_run(_request(run)))
    duplicate_result = asyncio.run(modal_api.post_run(_request(run)))
    assert duplicate_result["rank"] == 1

    with pytest.raises(HTTPException) as error:
        asyncio.run(modal_api.post_run(_request(_run_payload(31))))
    assert error.value.status_code == 429


def test_commentary_audio_is_optional_without_elevenlabs_key(monkeypatch):
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    monkeypatch.setattr(modal_api, "board", MemoryBoard())

    result = asyncio.run(modal_api._commentary_audio("Nice run", ["192.0.2.1"]))

    assert result is None


@pytest.mark.parametrize("has_content_length", [False, True])
def test_commentary_rejects_oversized_body_without_httpx(monkeypatch, has_content_length):
    calls = []

    class UnexpectedClient:
        def __init__(self, *args, **kwargs):
            calls.append(True)
            raise AssertionError("httpx client must not be constructed")

    monkeypatch.setattr(modal_api.httpx, "AsyncClient", UnexpectedClient)
    payload = _commentary_payload(time="x" * 1_000_000)
    headers = {"content-length": "1000000"} if has_content_length else None
    request = _request(payload, path="/commentary", headers=headers)

    with pytest.raises(HTTPException) as error:
        asyncio.run(modal_api.post_commentary(request))
    assert error.value.status_code == 413
    assert calls == []


@pytest.mark.parametrize(
    "payload",
    [
        _commentary_payload(time="30.5"),
        _commentary_payload(crashes=True),
    ],
)
def test_commentary_rejects_invalid_stats_without_httpx(monkeypatch, payload):
    calls = []

    class UnexpectedClient:
        def __init__(self, *args, **kwargs):
            calls.append(True)
            raise AssertionError("httpx client must not be constructed")

    monkeypatch.setattr(modal_api.httpx, "AsyncClient", UnexpectedClient)

    with pytest.raises(HTTPException) as error:
        asyncio.run(modal_api.post_commentary(_request(payload, path="/commentary")))
    assert error.value.status_code == 400
    assert error.value.detail == "Invalid commentary request"
    assert calls == []


@pytest.mark.parametrize("payload", [{}, {"time": 5}])
def test_commentary_requires_valid_time_before_consuming_slots(monkeypatch, payload):
    board = MemoryBoard()
    monkeypatch.setattr(modal_api, "board", board)

    with pytest.raises(HTTPException) as error:
        asyncio.run(modal_api.post_commentary(_request(payload, path="/commentary")))

    assert error.value.status_code == 400
    assert not any(key.startswith(("rl:cm:", "rl:gemini:")) for key in board)


def test_commentary_accepts_the_client_payload_and_returns_text(monkeypatch):
    monkeypatch.setattr(modal_api, "board", MemoryBoard())
    _stub_commentary(monkeypatch)

    result = asyncio.run(modal_api.post_commentary(
        _request(_commentary_payload(), path="/commentary")
    ))

    assert result == {"text": "Nice run", "audio": None}


def test_commentary_enforces_per_client_limit(monkeypatch):
    monkeypatch.setattr(modal_api, "board", MemoryBoard())
    monkeypatch.setattr(modal_api, "COMMENTARY_PER_IP_HOUR", 2)
    _stub_commentary(monkeypatch)
    request = lambda: _request(_commentary_payload(), path="/commentary")

    for _ in range(2):
        asyncio.run(modal_api.post_commentary(request()))
    with pytest.raises(HTTPException) as error:
        asyncio.run(modal_api.post_commentary(request()))
    assert error.value.status_code == 429
    assert error.value.detail == "Commentary limit reached"


def test_commentary_limits_many_ipv6_64s_in_one_48(monkeypatch):
    board = MemoryBoard()
    monkeypatch.setattr(modal_api, "board", board)
    _stub_commentary(monkeypatch)
    site_limit = modal_api.COMMENTARY_PER_IP_HOUR * modal_api.COMMENTARY_SITE_MULTIPLIER

    for index in range(site_limit):
        asyncio.run(modal_api.post_commentary(_request(
            _commentary_payload(),
            path="/commentary",
            client=(f"2001:db8:1234:{index:x}::1", 1234),
        )))

    with pytest.raises(HTTPException) as error:
        asyncio.run(modal_api.post_commentary(_request(
            _commentary_payload(),
            path="/commentary",
            client=(f"2001:db8:1234:{site_limit:x}::1", 1234),
        )))

    assert error.value.status_code == 429
    assert sum(
        value for key, value in board.items()
        if key.startswith("rl:gemini:") and key.endswith(":n")
    ) == site_limit


def test_commentary_enforces_global_gemini_limit(monkeypatch):
    monkeypatch.setattr(modal_api, "board", MemoryBoard())
    monkeypatch.setattr(modal_api, "COMMENTARY_GLOBAL_DAY", 2)
    _stub_commentary(monkeypatch)

    for index in range(2):
        asyncio.run(modal_api.post_commentary(_request(
            _commentary_payload(),
            path="/commentary",
            client=(f"198.51.100.{index + 1}", 1234),
        )))
    with pytest.raises(HTTPException) as error:
        asyncio.run(modal_api.post_commentary(_request(
            _commentary_payload(),
            path="/commentary",
            client=("198.51.100.3", 1234),
        )))
    assert error.value.status_code == 429


class _TTSResponse:
    content = b"audio"

    def raise_for_status(self):
        pass


def _stub_tts_client(monkeypatch):
    calls = []

    class TTSClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, *args, **kwargs):
            calls.append(True)
            return _TTSResponse()

    monkeypatch.setattr(modal_api.httpx, "AsyncClient", TTSClient)
    return calls


def test_tts_enforces_global_daily_limit_across_clients(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")
    monkeypatch.setattr(modal_api, "ELEVENLABS_VOICE_ID", "voice")
    monkeypatch.setattr(modal_api, "board", MemoryBoard())
    calls = _stub_tts_client(monkeypatch)

    async def make_requests():
        for index in range(81):
            await modal_api._commentary_audio(
                "Nice run", [f"192.0.2.{index + 1}"]
            )

    asyncio.run(make_requests())

    assert len(calls) == modal_api.TTS_GLOBAL_DAY


def test_tts_enforces_per_client_daily_limit(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")
    monkeypatch.setattr(modal_api, "ELEVENLABS_VOICE_ID", "voice")
    monkeypatch.setattr(modal_api, "board", MemoryBoard())
    calls = _stub_tts_client(monkeypatch)

    async def make_requests():
        for _ in range(modal_api.TTS_PER_IP_DAY + 5):
            await modal_api._commentary_audio("Nice run", ["192.0.2.1"])

    asyncio.run(make_requests())

    assert len(calls) == modal_api.TTS_PER_IP_DAY


def test_tts_limits_many_ipv6_64s_in_one_48(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")
    monkeypatch.setattr(modal_api, "ELEVENLABS_VOICE_ID", "voice")
    monkeypatch.setattr(modal_api, "board", MemoryBoard())

    async def commentary_text(stats):
        return "Nice run"

    monkeypatch.setattr(modal_api, "_commentary_text", commentary_text)
    calls = _stub_tts_client(monkeypatch)
    audio_clips = []

    async def make_requests():
        async def request(index):
            result = await modal_api.post_commentary(_request(
                _commentary_payload(),
                path="/commentary",
                client=(f"2001:db8:1234:{index:x}::1", 1234),
            ))
            if result["audio"] is not None:
                audio_clips.append(result["audio"])

        for index in range(20):
            await request(index)

    asyncio.run(make_requests())

    site_limit = modal_api.TTS_PER_IP_DAY * modal_api.TTS_SITE_MULTIPLIER
    assert len(calls) == site_limit
    assert len(audio_clips) == site_limit


def test_three_48s_cannot_exhaust_tts_global(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")
    monkeypatch.setattr(modal_api, "ELEVENLABS_VOICE_ID", "voice")
    board = MemoryBoard()
    monkeypatch.setattr(modal_api, "board", board)

    async def commentary_text(stats):
        return "Nice run"

    monkeypatch.setattr(modal_api, "_commentary_text", commentary_text)
    calls = _stub_tts_client(monkeypatch)

    async def make_requests():
        for site in ("2001:db8:1000", "2001:db8:2000", "2001:db8:3000"):
            for subnet in range(10):
                await modal_api.post_commentary(_request(
                    _commentary_payload(),
                    path="/commentary",
                    client=(f"{site}:{subnet:x}::1", 1234),
                ))

    asyncio.run(make_requests())

    day = modal_api.datetime.now(modal_api.timezone.utc).date().isoformat()
    global_slots = board.get(f"rl:tts:{day}:n", 0)
    assert len(calls) == global_slots
    assert global_slots <= 9
    assert global_slots < modal_api.TTS_GLOBAL_DAY


def test_tts_concurrent_calls_respect_per_client_limit(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")
    monkeypatch.setattr(modal_api, "ELEVENLABS_VOICE_ID", "voice")
    monkeypatch.setattr(modal_api, "TTS_PER_IP_DAY", 5)
    monkeypatch.setattr(modal_api, "board", MemoryBoard())
    calls = _stub_tts_client(monkeypatch)

    async def make_requests():
        await asyncio.gather(*[
            modal_api._commentary_audio("Nice run", ["192.0.2.1"])
            for _ in range(30)
        ])

    asyncio.run(make_requests())

    assert len(calls) <= 5
