#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mkdir -p /home/ubuntu/downhill-shots
cd "$ROOT"

server_pid=""
if ! curl -fsS http://127.0.0.1:4301/tools/assets/rider-preview.html >/dev/null; then
  python3 -m http.server 4301 --bind 127.0.0.1 >/dev/null 2>&1 &
  server_pid=$!
  trap '[[ -z "$server_pid" ]] || kill "$server_pid" 2>/dev/null || true' EXIT
  for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:4301/tools/assets/rider-preview.html >/dev/null; then break; fi
    sleep 0.2
  done
fi

node tools/assets/capture-riders.mjs
