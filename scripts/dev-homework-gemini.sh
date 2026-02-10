#!/usr/bin/env bash
set -euo pipefail

mode="${1:-dev}"

branch="$(git branch --show-current 2>/dev/null || true)"
if [[ "${branch}" != "homework" ]]; then
  echo "error: current branch is '${branch:-unknown}', expected 'homework'" >&2
  exit 1
fi

if [[ ! -f ".env.local" ]]; then
  echo "error: .env.local not found; add GEMINI_API_KEY first" >&2
  exit 1
fi

gemini_line="$(rg -n '^GEMINI_API_KEY=.+' .env.local || true)"
if [[ -z "${gemini_line}" ]]; then
  echo "error: GEMINI_API_KEY is missing or empty in .env.local" >&2
  exit 1
fi

if rg -n '^COMPASS_API_KEY=|^COMPASS_GATEWAY_URL=|^GATEWAY_URL=' .env.local >/dev/null 2>&1; then
  echo "warn: Compass/Gateway vars found in .env.local; they are ignored in homework Gemini mode."
fi

if rg -n 'COMPASS_API_KEY|COMPASS_GATEWAY_URL|GATEWAY_URL' vite.config.ts >/dev/null 2>&1; then
  echo "error: vite.config.ts still contains Compass gateway references" >&2
  exit 1
fi

if ! rg -n "type ModelProvider = 'gemini';" vite.config.ts >/dev/null 2>&1; then
  echo "error: vite.config.ts is not locked to Gemini-only provider mode" >&2
  exit 1
fi

echo "ok: homework branch + GEMINI_API_KEY validated."
if [[ "${mode}" == "--check" ]]; then
  exit 0
fi

exec npm run dev
