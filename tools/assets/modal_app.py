import base64
import json
import os
import re
import time
from typing import Any
from pathlib import Path

import modal


APP_NAME = "downhill-assets"
MOUNT_PATH = Path("/assets")
MANIFEST_PATH = Path(__file__).with_name("manifest.json")
MESHY_API = "https://api.meshy.ai"
ELEVENLABS_API = "https://api.elevenlabs.io/v1"
POLL_INTERVAL_SECONDS = 10
TASK_TIMEOUT_SECONDS = 1200

app = modal.App(APP_NAME)
volume = modal.Volume.from_name(APP_NAME, create_if_missing=True)
api_secret = modal.Secret.from_name(APP_NAME)
image = modal.Image.debian_slim(python_version="3.12").pip_install("requests")


class ProviderError(RuntimeError):
    def __init__(self, provider: str, status_code: int, message: str):
        super().__init__(f"{provider} returned HTTP {status_code}: {message}")
        self.provider = provider
        self.status_code = status_code


def _request(
    provider: str,
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    json_body: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
    timeout: int = 180,
):
    import requests

    for attempt in range(6):
        response = requests.request(
            method,
            url,
            headers=headers,
            json=json_body,
            params=params,
            timeout=timeout,
        )
        if response.status_code == 429 and attempt < 5:
            try:
                delay = max(1, min(60, int(response.headers.get("Retry-After", "10"))))
            except ValueError:
                delay = 10
            time.sleep(delay)
            continue
        if not response.ok:
            try:
                details = response.json()
            except ValueError:
                details = response.text[:500]
            raise ProviderError(provider, response.status_code, str(details)[:500])
        return response
    raise RuntimeError(f"{provider} rate limit retry limit reached")


def _json_response(response) -> dict[str, Any]:
    return response.json()


def _task_credits(task: dict[str, Any]) -> Any:
    for key in ("consumed_credits", "credits_used", "credits", "credit_cost"):
        if task.get(key) is not None:
            return task[key]
    return None


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    temp_path.replace(path)
    volume.commit()


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return {}


def _safe_name(name: str) -> None:
    if not re.fullmatch(r"[a-z0-9-]+", name):
        raise ValueError(f"Asset name must use lowercase letters, digits, or hyphens: {name}")


def _output_paths(kind: str, name: str, extension: str) -> tuple[Path, Path]:
    _safe_name(name)
    directory = MOUNT_PATH / "raw" / kind
    return directory / f"{name}.{extension}", directory / f"{name}.json"


def _headers(provider: str) -> dict[str, str]:
    if provider == "Meshy":
        key = os.environ.get("MESHY_API_KEY")
        if not key:
            raise RuntimeError("MESHY_API_KEY is missing from the Modal Secret")
        return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        raise RuntimeError("ELEVENLABS_API_KEY is missing from the Modal Secret")
    return {"xi-api-key": key}


def _poll_meshy(path: str, task_id: str, headers: dict[str, str]) -> dict[str, Any]:
    deadline = time.monotonic() + TASK_TIMEOUT_SECONDS
    last_status = None
    while time.monotonic() < deadline:
        task = _json_response(_request("Meshy", "GET", f"{MESHY_API}{path}/{task_id}", headers=headers))
        status = task.get("status", "").upper()
        if status != last_status:
            print(f"Meshy task {task_id}: {status or 'unknown'}")
            last_status = status
        if status == "SUCCEEDED":
            return task
        if status in {"FAILED", "CANCELED", "EXPIRED"}:
            error = task.get("task_error") or {}
            raise RuntimeError(f"Meshy task {task_id} {status}: {error.get('message', '')}")
        time.sleep(POLL_INTERVAL_SECONDS)
    raise TimeoutError(f"Meshy task {task_id} exceeded {TASK_TIMEOUT_SECONDS}s")


def _download(url: str, destination: Path) -> None:
    import requests

    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_path = destination.with_suffix(destination.suffix + ".tmp")
    with requests.get(url, stream=True, timeout=180) as response:
        response.raise_for_status()
        with temp_path.open("wb") as output:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    output.write(chunk)
    temp_path.replace(destination)


def _is_plan_rejection(error: ProviderError) -> bool:
    message = str(error).lower()
    return error.status_code in {402, 403} or (
        error.status_code in {400, 404, 422}
        and any(term in message for term in ("plan", "subscription", "credit", "quota", "limit"))
    )


def _record_audio_response(metadata: dict[str, Any], response) -> None:
    task_ids = metadata.setdefault("task_ids", {})
    for header, key in (
        ("history-item-id", "history_item"),
        ("request-id", "request"),
        ("x-request-id", "request"),
    ):
        if response.headers.get(header):
            task_ids[key] = response.headers[header]
    for header in ("credits-used", "x-credits-used", "credit-cost"):
        if response.headers.get(header):
            metadata.setdefault("credits_used", {})["generation"] = response.headers[header]


def _save_plan_skip(metadata: dict[str, Any], sidecar: Path, error: ProviderError) -> dict[str, str]:
    metadata["status"] = "skipped"
    metadata["skip_reason"] = str(error)
    _write_json(sidecar, metadata)
    print(f"Skipped {metadata['kind']}/{metadata['name']}: {error}")
    return {"name": metadata["name"], "status": "skipped"}


@app.function(
    image=image,
    volumes={"/assets": volume},
    secrets=[api_secret],
    cpu=1,
    memory=1024,
    timeout=TASK_TIMEOUT_SECONDS + 300,
    max_containers=2,
)
def generate_model(entry: dict[str, Any], force: bool = False) -> dict[str, str]:
    volume.reload()
    name = entry["name"]
    output, sidecar = _output_paths("models", name, "glb")
    rigged_output = output.with_name(f"{name}-rigged.glb")
    if not force and output.exists() and (not entry.get("rig") or rigged_output.exists()):
        return {"name": name, "status": "skipped"}

    metadata = _read_json(sidecar) if not force else {}
    metadata.update(
        {
            "kind": "models",
            "name": name,
            "prompt": entry["prompt"],
            "polycount": entry["polycount"],
            "rig": bool(entry.get("rig", False)),
            "task_ids": metadata.get("task_ids", {}),
            "credits_used": metadata.get("credits_used", {}),
        }
    )
    headers = _headers("Meshy")
    base = "/openapi/v2/text-to-3d"

    try:
        if force or not output.exists():
            preview_id = metadata["task_ids"].get("preview")
            if not preview_id:
                preview_response = _json_response(
                    _request(
                        "Meshy",
                        "POST",
                        f"{MESHY_API}{base}",
                        headers=headers,
                        json_body={
                            "mode": "preview",
                            "prompt": entry["prompt"],
                            "model_type": "smart-topology",
                            "ai_model": "meshy-t2.5",
                            "target_polycount": entry["polycount"],
                            "target_formats": ["glb"],
                        },
                    )
                )
                preview_id = preview_response["result"]
                metadata["task_ids"]["preview"] = preview_id
                metadata["status"] = "preview_pending"
                _write_json(sidecar, metadata)

            preview = _poll_meshy(base, preview_id, headers)
            if (credits := _task_credits(preview)) is not None:
                metadata["credits_used"]["preview"] = credits
            metadata["status"] = "preview_succeeded"
            _write_json(sidecar, metadata)

            refine_id = metadata["task_ids"].get("refine")
            if not refine_id:
                refine_response = _json_response(
                    _request(
                        "Meshy",
                        "POST",
                        f"{MESHY_API}{base}",
                        headers=headers,
                        json_body={
                            "mode": "refine",
                            "preview_task_id": preview_id,
                            "enable_pbr": True,
                            "texture_resolution": "2k",
                            "target_formats": ["glb"],
                        },
                    )
                )
                refine_id = refine_response["result"]
                metadata["task_ids"]["refine"] = refine_id
                metadata["status"] = "refine_pending"
                _write_json(sidecar, metadata)

            refined = _poll_meshy(base, refine_id, headers)
            if (credits := _task_credits(refined)) is not None:
                metadata["credits_used"]["refine"] = credits
            model_url = (refined.get("model_urls") or {}).get("glb")
            if not model_url:
                raise RuntimeError(f"Meshy refine task {refine_id} did not return a GLB URL")
            _download(model_url, output)
            metadata["status"] = "refine_succeeded"
            _write_json(sidecar, metadata)

        if entry.get("rig") and (force or not rigged_output.exists()):
            rig_id = metadata["task_ids"].get("rig")
            if not rig_id:
                if metadata["task_ids"].get("refine"):
                    rig_body = {"input_task_id": metadata["task_ids"]["refine"]}
                else:
                    model_bytes = output.read_bytes()
                    if len(model_bytes) > 100 * 1024 * 1024:
                        raise RuntimeError("Meshy rigging data URI limit is 100 MiB")
                    rig_body = {
                        "model_url": "data:application/octet-stream;base64,"
                        + base64.b64encode(model_bytes).decode("ascii")
                    }
                rig_response = _json_response(
                    _request(
                        "Meshy",
                        "POST",
                        f"{MESHY_API}/openapi/v1/rigging",
                        headers=headers,
                        json_body=rig_body,
                    )
                )
                rig_id = rig_response["result"]
                metadata["task_ids"]["rig"] = rig_id
                metadata["status"] = "rig_pending"
                _write_json(sidecar, metadata)

            rigged = _poll_meshy("/openapi/v1/rigging", rig_id, headers)
            if (credits := _task_credits(rigged)) is not None:
                metadata["credits_used"]["rig"] = credits
            rigged_url = (rigged.get("result") or {}).get("rigged_character_glb_url")
            if not rigged_url:
                raise RuntimeError(f"Meshy rigging task {rig_id} did not return a rigged GLB URL")
            _download(rigged_url, rigged_output)

        metadata["status"] = "complete"
        _write_json(sidecar, metadata)
        return {"name": name, "status": "complete"}
    except ProviderError as error:
        if _is_plan_rejection(error):
            if output.exists() and entry.get("rig") and not rigged_output.exists():
                metadata["status"] = "partial"
                metadata["rig_skip_reason"] = str(error)
                _write_json(sidecar, metadata)
                print(f"Skipped rigging {name}: {error}")
                return {"name": name, "status": "partial"}
            return _save_plan_skip(metadata, sidecar, error)
        raise


def _generate_audio(
    kind: str,
    entry: dict[str, Any],
    force: bool,
    request_url: str,
    request_body: dict[str, Any],
    voice_id: str | None = None,
) -> dict[str, str]:
    volume.reload()
    name = entry["name"]
    output, sidecar = _output_paths(kind, name, "mp3")
    if not force and output.exists():
        return {"name": name, "status": "skipped"}

    prompt = entry.get("prompt", entry.get("text", ""))
    metadata = _read_json(sidecar) if not force else {}
    metadata.update(
        {
            "kind": kind,
            "name": name,
            "prompt": prompt,
            "task_ids": metadata.get("task_ids", {}),
            "credits_used": metadata.get("credits_used", {}),
        }
    )
    if voice_id:
        metadata["voice_id"] = voice_id
        metadata["style"] = entry["style"]

    try:
        response = _request(
            "ElevenLabs",
            "POST",
            request_url,
            headers=_headers("ElevenLabs"),
            json_body=request_body,
            params={"output_format": "mp3_44100_128"},
            timeout=600,
        )
    except ProviderError as error:
        if _is_plan_rejection(error):
            return _save_plan_skip(metadata, sidecar, error)
        raise

    output.parent.mkdir(parents=True, exist_ok=True)
    temp_path = output.with_suffix(output.suffix + ".tmp")
    temp_path.write_bytes(response.content)
    temp_path.replace(output)
    _record_audio_response(metadata, response)
    metadata["status"] = "complete"
    _write_json(sidecar, metadata)
    return {"name": name, "status": "complete"}


@app.function(
    image=image,
    volumes={"/assets": volume},
    secrets=[api_secret],
    cpu=1,
    memory=1024,
    timeout=TASK_TIMEOUT_SECONDS + 300,
    max_containers=2,
)
def generate_sfx(entry: dict[str, Any], force: bool = False) -> dict[str, str]:
    body = {
        "text": entry["prompt"],
        "duration_seconds": entry["seconds"],
        "loop": bool(entry.get("loop", False)),
    }
    return _generate_audio(
        "sfx",
        entry,
        force,
        f"{ELEVENLABS_API}/sound-generation",
        body,
    )


@app.function(
    image=image,
    volumes={"/assets": volume},
    secrets=[api_secret],
    cpu=1,
    memory=1024,
    timeout=TASK_TIMEOUT_SECONDS + 300,
    max_containers=2,
)
def generate_music(entry: dict[str, Any], force: bool = False) -> dict[str, str]:
    body = {
        "prompt": entry["prompt"],
        "music_length_ms": round(entry["seconds"] * 1000),
        "model_id": "music_v2_5",
        "force_instrumental": True,
    }
    return _generate_audio(
        "music",
        entry,
        force,
        f"{ELEVENLABS_API}/music",
        body,
    )


def _select_stock_voice(style: str, headers: dict[str, str]) -> dict[str, Any]:
    response = _json_response(
        _request(
            "ElevenLabs",
            "GET",
            f"{ELEVENLABS_API}/voices",
            headers=headers,
            params={"show_legacy": "true"},
        )
    )
    voices = [voice for voice in response.get("voices", []) if voice.get("category") == "premade"]
    if not voices:
        raise RuntimeError("ElevenLabs did not return any premade stock voices")

    def score(voice: dict[str, Any]) -> int:
        labels = voice.get("labels") or {}
        descriptors = " ".join(
            [voice.get("name", ""), voice.get("description", "")]
            + [str(value) for value in labels.values()]
        ).lower()
        result = 0
        if str(labels.get("gender", "")).lower() == "male" or " male " in f" {descriptors} ":
            result += 20
        for term in ("energetic", "sports", "commentator", "announcer", "confident", "excited"):
            if term in descriptors:
                result += 2
        if str(labels.get("accent", "")).lower() in {"american", "american english"}:
            result += 2
        if "sports" in style.lower() and any(
            term in descriptors for term in ("narration", "social media", "entertainment")
        ):
            result += 1
        return result

    return max(voices, key=score)


@app.function(
    image=image,
    volumes={"/assets": volume},
    secrets=[api_secret],
    cpu=1,
    memory=1024,
    timeout=TASK_TIMEOUT_SECONDS + 300,
    max_containers=2,
)
def generate_voice(entry: dict[str, Any], force: bool = False) -> dict[str, str]:
    volume.reload()
    output, sidecar = _output_paths("voice", entry["name"], "mp3")
    if not force and output.exists():
        return {"name": entry["name"], "status": "skipped"}

    headers = _headers("ElevenLabs")
    voice = _select_stock_voice(entry["style"], headers)
    voice_id = voice["voice_id"]
    body = {
        "text": entry["text"],
        "model_id": "eleven_multilingual_v2",
    }
    return _generate_audio(
        "voice",
        entry,
        force,
        f"{ELEVENLABS_API}/text-to-speech/{voice_id}",
        body,
        voice_id=voice_id,
    )


@app.local_entrypoint()
def main(kind: str, only: str = "", force: bool = False) -> None:
    with MANIFEST_PATH.open() as manifest_file:
        manifest = json.load(manifest_file)

    voice = manifest["voice"]
    entries_by_kind = {
        "models": manifest["models"],
        "sfx": manifest["sfx"],
        "music": manifest["music"],
        "voice": [
            {**line, "style": voice["style"]}
            for line in voice["lines"]
        ],
    }
    functions = {
        "models": generate_model,
        "sfx": generate_sfx,
        "music": generate_music,
        "voice": generate_voice,
    }
    if kind not in {"models", "sfx", "music", "voice", "all"}:
        raise ValueError(f"Unsupported kind: {kind}")

    selected_kinds = list(entries_by_kind) if kind == "all" else [kind]
    only_names = {name.strip() for name in only.split(",") if name.strip()}
    for selected_kind in selected_kinds:
        entries = [
            entry
            for entry in entries_by_kind[selected_kind]
            if not only_names or entry["name"] in only_names
        ]
        if only_names and not entries:
            print(f"No {selected_kind} entries match --only {only}")
            continue
        results = list(functions[selected_kind].starmap((entry, force) for entry in entries))
        print(f"{selected_kind}: {results}")
