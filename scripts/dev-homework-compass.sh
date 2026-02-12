#!/usr/bin/env bash
set -euo pipefail

mode="${1:-dev}"

have_rg=0
if command -v rg >/dev/null 2>&1; then
  have_rg=1
fi

line_with_value() {
  local key="$1"
  if [[ "${have_rg}" == "1" ]]; then
    rg -n "^${key}=.+" .env.local || true
  else
    grep -nE "^${key}=.+" .env.local || true
  fi
}

last_value() {
  local key="$1"
  if [[ "${have_rg}" == "1" ]]; then
    rg "^${key}=" .env.local | tail -n1 | sed -E "s/^${key}=//" || true
  else
    grep -E "^${key}=" .env.local | tail -n1 | sed -E "s/^${key}=//" || true
  fi
}

branch="$(git branch --show-current 2>/dev/null || true)"
if [[ "${branch}" != "homework" && "${branch}" != "main" ]]; then
  echo "error: current branch is '${branch:-unknown}', expected 'homework' or 'main'" >&2
  exit 1
fi

if [[ ! -f ".env.local" ]]; then
  echo "error: .env.local not found" >&2
  exit 1
fi

compass_key_line="$(line_with_value "COMPASS_API_KEY")"
compass_gateway_line="$(line_with_value "COMPASS_GATEWAY_URL")"
video_key_line="$(line_with_value "GEMINI_VIDEO_API_KEY")"
gemini_key_line="$(line_with_value "GEMINI_API_KEY")"
gemini_video_base_line="$(line_with_value "GEMINI_VIDEO_BASE_URL")"

if [[ -z "${compass_key_line}" ]]; then
  echo "error: COMPASS_API_KEY is missing or empty in .env.local" >&2
  exit 1
fi
if [[ -z "${compass_gateway_line}" ]]; then
  echo "error: COMPASS_GATEWAY_URL is missing or empty in .env.local" >&2
  exit 1
fi
if [[ -z "${video_key_line}" && -z "${gemini_key_line}" ]]; then
  echo "error: GEMINI_VIDEO_API_KEY missing, and no GEMINI_API_KEY fallback found in .env.local" >&2
  exit 1
fi

compass_key="$(last_value "COMPASS_API_KEY")"
compass_gateway="$(last_value "COMPASS_GATEWAY_URL")"
video_key="$(last_value "GEMINI_VIDEO_API_KEY")"
gemini_key="$(last_value "GEMINI_API_KEY")"
video_base="$(last_value "GEMINI_VIDEO_BASE_URL")"

if [[ -z "${video_key}" ]]; then
  video_key="${gemini_key}"
fi
if [[ -z "${video_base}" ]]; then
  video_base="https://generativelanguage.googleapis.com/v1beta"
fi

if [[ "${mode}" == "--check" ]]; then
  echo "ok: compass mode config detected."
  echo "llm/image -> COMPASS_GATEWAY_URL"
  echo "video     -> GEMINI_VIDEO_BASE_URL (${video_base})"
  echo "image mode -> compass only"
  exit 0
fi

echo "info: launching dev in compass mode"
echo "      llm/image -> ${compass_gateway}"
echo "      video     -> ${video_base}"

export GEMINI_API_KEY="${compass_key}"
export GEMINI_BASE_URL="${compass_gateway%/}"
export GEMINI_VIDEO_API_KEY="${video_key}"
export GEMINI_VIDEO_BASE_URL="${video_base%/}"
export VISION_IMAGE_COMPASS_ONLY=1
export VISION_IMAGE_DUAL_CHANNEL=0
export GEMINI_IMAGE_GEMINI_API_KEY="${compass_key}"
export GEMINI_IMAGE_GEMINI_BASE_URL="${compass_gateway%/}"
export GEMINI_IMAGE_COMPASS_API_KEY="${compass_key}"
export GEMINI_IMAGE_COMPASS_BASE_URL="${compass_gateway%/}"

exec npm run dev
