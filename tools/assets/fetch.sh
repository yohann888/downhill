#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RAW_DIR="$ROOT/tools/assets/raw"
MODEL_DIR="$ROOT/public/assets/models"
AUDIO_DIR="$ROOT/public/assets/audio"

mkdir -p "$RAW_DIR" "$MODEL_DIR" "$AUDIO_DIR"
modal volume get downhill-assets raw "$ROOT/tools/assets" --force

while IFS= read -r -d '' model; do
  filename="$(basename "$model")"
  name="${filename%.glb}"
  if [[ ! "$name" =~ ^[a-z0-9-]+$ ]]; then
    printf 'Invalid model filename: %s\n' "$filename" >&2
    exit 1
  fi

  texture_size=1024
  if [[ "$name" =~ (pine|tree|rock|boulder) ]]; then
    texture_size=512
  fi
  output="$MODEL_DIR/$filename"
  before="$(wc -c < "$model")"
  (
    cd "$ROOT"
    npx --no-install gltf-transform optimize "$model" "$output" \
      --texture-size "$texture_size" \
      --texture-compress webp \
      --compress meshopt
  )
  after="$(wc -c < "$output")"
  printf '%s %s -> %s bytes\n' "$filename" "$before" "$after"
done < <(find "$RAW_DIR/models" -type f -name '*.glb' -print0 2>/dev/null)

while IFS= read -r -d '' audio; do
  filename="$(basename "$audio")"
  name="${filename%.mp3}"
  if [[ ! "$name" =~ ^[a-z0-9-]+$ ]]; then
    printf 'Invalid audio filename: %s\n' "$filename" >&2
    exit 1
  fi

  output="$AUDIO_DIR/$filename"
  duration=""
  if command -v ffprobe >/dev/null 2>&1; then
    duration="$(ffprobe -v error -show_entries format=duration \
      -of default=noprint_wrappers=1:nokey=1 "$audio" 2>/dev/null || true)"
  fi
  size="$(wc -c < "$audio")"
  if [[ -n "$duration" ]] && awk -v bytes="$size" -v seconds="$duration" \
      'BEGIN { exit !(bytes > seconds * 30 * 1024) }'; then
    if ! command -v ffmpeg >/dev/null 2>&1; then
      printf 'ffmpeg is required to re-encode oversized audio: %s\n' "$filename" >&2
      exit 1
    fi
    ffmpeg -hide_banner -loglevel error -y -i "$audio" \
      -codec:a libmp3lame -b:a 128k "$output"
  else
    cp "$audio" "$output"
  fi
  printf '%s %s bytes\n' "$filename" "$(wc -c < "$output")"
done < <(find "$RAW_DIR" -type f -name '*.mp3' -print0 2>/dev/null)

total_bytes="$(find "$ROOT/public/assets" -type f -print0 | xargs -0 -r wc -c | awk 'END { print $1 + 0 }')"
printf 'public/assets total: %s bytes\n' "$total_bytes"
if (( total_bytes > 7 * 1024 * 1024 )); then
  printf 'public/assets exceeds the 7 MiB target\n' >&2
fi
