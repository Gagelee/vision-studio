#!/usr/bin/env python3
"""
Minimal Compass connectivity check.

Usage:
  COMPASS_API_KEY=... COMPASS_GATEWAY_URL=https://compass.llm.shopee.io/compass-api/v1 MODEL_NAME=gemini-3-flash-preview \\
    python3 scripts/check_compass.py
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


def _strip_trailing_slash(url: str) -> str:
    return url[:-1] if url.endswith("/") else url


def _maybe_load_dotenv(path: str) -> None:
    """
    Minimal .env parser (KEY=VALUE), supports quotes and ignores comments.
    Only fills missing os.environ keys (does not override).
    """
    try:
        with open(path, "r", encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" not in line:
                    continue
                k, v = line.split("=", 1)
                key = k.strip()
                if not key or key in os.environ:
                    continue
                val = v.strip()
                if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                    val = val[1:-1]
                os.environ[key] = val
    except FileNotFoundError:
        return
    except OSError:
        return


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--env-file",
        default="",
        help="Optional .env file to load (default: auto-load repo .env.local if present).",
    )
    ap.add_argument("--gateway-url", default=os.environ.get("COMPASS_GATEWAY_URL") or os.environ.get("GATEWAY_URL") or "")
    ap.add_argument("--api-key", default=os.environ.get("COMPASS_API_KEY") or "")
    ap.add_argument("--model", default=os.environ.get("MODEL_NAME") or "gemini-3-flash-preview")
    ap.add_argument("--timeout-s", type=float, default=20.0)
    args = ap.parse_args(argv)

    # Auto-load repo .env.local for convenience (does not affect other processes).
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(script_dir, ".."))
    env_path = args.env_file.strip() or os.path.join(repo_root, ".env.local")
    _maybe_load_dotenv(env_path)

    # Re-read from env after dotenv load so users don't have to export manually.
    if not args.api_key:
        args.api_key = os.environ.get("COMPASS_API_KEY") or ""
    if not args.gateway_url:
        args.gateway_url = os.environ.get("COMPASS_GATEWAY_URL") or os.environ.get("GATEWAY_URL") or ""
    if not args.model:
        args.model = os.environ.get("MODEL_NAME") or "gemini-3-flash-preview"

    key = (args.api_key or "").strip()
    gateway = _strip_trailing_slash((args.gateway_url or "").strip())
    model = (args.model or "").strip()

    if not key:
        print("Missing COMPASS_API_KEY (or --api-key)", file=sys.stderr)
        return 2
    if not gateway:
        print("Missing COMPASS_GATEWAY_URL (or --gateway-url)", file=sys.stderr)
        return 2
    if not model:
        print("Missing MODEL_NAME (or --model)", file=sys.stderr)
        return 2

    url = f"{gateway}/models/{urllib.parse.quote(model)}:generateContent"
    payload = {
        "contents": [{"role": "user", "parts": [{"text": "Return exactly: OK"}]}],
        "generationConfig": {"temperature": 0, "maxOutputTokens": 32},
    }

    req = urllib.request.Request(
        url=url,
        method="POST",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "content-type": "application/json",
            # Compass gateway follows Google genai style key usage.
            "x-goog-api-key": key,
        },
    )

    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=args.timeout_s) as resp:
            raw = resp.read() or b""
            ms = int((time.time() - started) * 1000)
            text = raw.decode("utf-8", errors="replace")
            print(json.dumps({"ok": True, "status": resp.status, "ms": ms, "url": url, "preview": text[:400]}, ensure_ascii=False, indent=2))
            return 0 if 200 <= resp.status < 300 else 1
    except urllib.error.HTTPError as e:
        raw = e.read() or b""
        ms = int((time.time() - started) * 1000)
        text = raw.decode("utf-8", errors="replace")
        print(json.dumps({"ok": False, "status": e.code, "ms": ms, "url": url, "preview": text[:400]}, ensure_ascii=False, indent=2))
        return 1
    except urllib.error.URLError as e:
        ms = int((time.time() - started) * 1000)
        print(json.dumps({"ok": False, "status": 0, "ms": ms, "url": url, "error": str(e.reason)}, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
