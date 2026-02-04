#!/usr/bin/env python3
"""
Quick API connectivity check for local dev/preview servers.

Examples:
  python scripts/check_api.py --base http://127.0.0.1:3000
  python scripts/check_api.py --base http://127.0.0.1:4173 --require-http
  python scripts/check_api.py --base http://127.0.0.1:4173 --include-image
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
import urllib.parse


def _strip_trailing_slash(url: str) -> str:
    return url[:-1] if url.endswith("/") else url


def _pretty(obj) -> str:
    return json.dumps(obj, indent=2, ensure_ascii=False)


def _request_json(opener: urllib.request.OpenerDirector, method: str, url: str, body_obj, timeout_s: float):
    data = json.dumps(body_obj).encode("utf-8") if body_obj is not None else None
    req = urllib.request.Request(
        url=url,
        method=method,
        data=data,
        headers={"content-type": "application/json"},
    )
    started = time.time()
    try:
        with opener.open(req, timeout=timeout_s) as resp:
            raw = resp.read() or b""
            text = raw.decode("utf-8", errors="replace")
            try:
                parsed = json.loads(text)
            except Exception:
                parsed = None
            return {
                "url": url,
                "ms": int((time.time() - started) * 1000),
                "status": resp.status,
                "ok": 200 <= resp.status < 300,
                "json": parsed,
                "textPreview": text[:280],
            }
    except urllib.error.HTTPError as e:
        raw = e.read() or b""
        text = raw.decode("utf-8", errors="replace")
        try:
            parsed = json.loads(text)
        except Exception:
            parsed = None
        return {
            "url": url,
            "ms": int((time.time() - started) * 1000),
            "status": e.code,
            "ok": False,
            "json": parsed,
            "textPreview": text[:280],
        }
    except urllib.error.URLError as e:
        return {
            "url": url,
            "ms": int((time.time() - started) * 1000),
            "status": 0,
            "ok": False,
            "json": None,
            "textPreview": f"{e.reason}",
        }


def _head(opener: urllib.request.OpenerDirector, url: str, timeout_s: float):
    req = urllib.request.Request(url=url, method="HEAD")
    started = time.time()
    try:
        with opener.open(req, timeout=timeout_s) as resp:
            return {
                "url": url,
                "ms": int((time.time() - started) * 1000),
                "status": resp.status,
                "ok": 200 <= resp.status < 300,
                "contentType": resp.headers.get("content-type", ""),
                "contentLength": resp.headers.get("content-length", ""),
            }
    except urllib.error.HTTPError as e:
        return {
            "url": url,
            "ms": int((time.time() - started) * 1000),
            "status": e.code,
            "ok": False,
            "contentType": e.headers.get("content-type", "") if e.headers else "",
            "contentLength": e.headers.get("content-length", "") if e.headers else "",
        }
    except urllib.error.URLError as e:
        return {
            "url": url,
            "ms": int((time.time() - started) * 1000),
            "status": 0,
            "ok": False,
            "contentType": "",
            "contentLength": "",
            "error": f"{e.reason}",
        }


def _assert(cond: bool, msg: str):
    if not cond:
        raise RuntimeError(msg)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:3000", help="Base URL, e.g. http://127.0.0.1:3000")
    ap.add_argument(
        "--require-http",
        action="store_true",
        help='Fail if any endpoint falls back (debug.transport != "http")',
    )
    ap.add_argument(
        "--allow-single-fallback",
        action="store_true",
        help="Allow server-side single-call fallback when multi-agent fails (opt-in).",
    )
    ap.add_argument(
        "--dump-error-json",
        action="store_true",
        help="Print full JSON error bodies for failed requests.",
    )
    ap.add_argument("--include-image", action="store_true", help="Also test /api/asset/image/generate and fetch generated asset")
    ap.add_argument("--timeout-s", type=float, default=60.0, help="Timeout in seconds (default 60)")
    args = ap.parse_args(argv)

    base = _strip_trailing_slash(args.base)
    results = []

    def _summarize_multi_agent_failure(name: str, payload: dict) -> str:
        if payload.get("errorCode") != "MULTI_AGENT_FAILED":
            return ""
        multi_err = str(payload.get("multiAgentError") or payload.get("message") or "")
        trace = payload.get("teamTrace")
        first_fail = ""
        if isinstance(trace, list):
            for step in trace:
                if isinstance(step, dict) and step.get("ok") is False:
                    first_fail = f"{step.get('agent')} ({step.get('provider')}/{step.get('model')}): {step.get('error')}"
                    break
        hint = "Tip: re-run with --allow-single-fallback to opt into single-call fallback."
        bits = [f"{name}: MULTI_AGENT_FAILED", multi_err]
        if first_fail:
            bits.append(f"firstFail={first_fail}")
        bits.append(hint)
        return " | ".join([b for b in bits if b])

    # Avoid accidental proxying for localhost when users set HTTP(S)_PROXY for Gemini.
    # (Python urllib honors env proxies by default; without NO_PROXY this can break localhost calls.)
    try:
        base_host = urllib.parse.urlparse(base).hostname or ""
    except Exception:
        base_host = ""

    is_localhost = base_host in ("localhost", "0.0.0.0", "127.0.0.1") or base_host.startswith("127.")
    if is_localhost:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    else:
        opener = urllib.request.build_opener()

    # Scaffold
    scaffold = _request_json(
        opener,
        "POST",
        f"{base}/api/agent/scaffold",
        {
            "intent": "API connectivity test",
            "aspectRatio": "16:9",
            "allowSingleFallback": bool(args.allow_single_fallback),
            "settings": {"provider": "gemini", "model": "gemini-3-pro-preview", "temperature": 0.4, "maxOutputTokens": 8192},
        },
        args.timeout_s,
    )
    results.append(
        {
            "name": "scaffold",
            **{k: scaffold[k] for k in ["url", "ms", "status", "ok", "textPreview"]},
            "debug": (scaffold.get("json") or {}).get("debug") if isinstance(scaffold.get("json"), dict) else None,
        }
    )
    if not scaffold["ok"]:
        if isinstance(scaffold.get("json"), dict):
            msg = _summarize_multi_agent_failure("scaffold", scaffold["json"])
            if msg:
                if args.dump_error_json:
                    print(_pretty(scaffold["json"]), file=sys.stderr)
                raise RuntimeError(msg)
        raise RuntimeError(f"scaffold HTTP {scaffold['status']}")
    _assert(isinstance(scaffold.get("json"), dict) and scaffold["json"].get("ok") is True, f"scaffold: expected {{ok:true}} (got {scaffold['textPreview']})")
    _assert("story" in scaffold["json"] and "plan" in scaffold["json"], "scaffold: missing story/plan")
    if args.require_http:
        transport = scaffold["json"].get("debug", {}).get("transport")
        err = scaffold["json"].get("debug", {}).get("error")
        _assert(
            transport == "http",
            f"scaffold: transport={transport!r}{(' error=' + repr(err)) if err else ''}",
        )

    story = scaffold["json"]["story"]

    # Try to pick a real selection from the scaffolded story for /api/agent/direct.
    selection = {"type": "story", "id": str(story.get("id") or "")}
    try:
        seqs = story.get("sequences") if isinstance(story, dict) else None
        if isinstance(seqs, list) and seqs:
            seq0 = seqs[0] if isinstance(seqs[0], dict) else None
            if isinstance(seq0, dict) and seq0.get("id"):
                shots = seq0.get("shots")
                if isinstance(shots, list) and shots and isinstance(shots[0], dict) and shots[0].get("id"):
                    selection = {"type": "shot", "id": str(shots[0]["id"]), "parentId": str(seq0["id"])}
                else:
                    selection = {"type": "sequence", "id": str(seq0["id"])}
    except Exception:
        selection = {"type": "story", "id": str(story.get("id") or "")}

    # Director
    direct = _request_json(
        opener,
        "POST",
        f"{base}/api/agent/direct",
        {
            "message": "make it warmer",
            "selection": selection,
            "story": story,
            "allowSingleFallback": bool(args.allow_single_fallback),
            "settings": {"provider": "gemini", "model": "gemini-3-pro-preview", "temperature": 0.3, "maxOutputTokens": 4096},
        },
        args.timeout_s,
    )
    results.append({"name": "direct", **{k: direct[k] for k in ["url", "ms", "status", "ok", "textPreview"]}, "debug": (direct.get("json") or {}).get("debug")})
    if not direct["ok"]:
        if isinstance(direct.get("json"), dict):
            msg = _summarize_multi_agent_failure("direct", direct["json"])
            if msg:
                if args.dump_error_json:
                    print(_pretty(direct["json"]), file=sys.stderr)
                raise RuntimeError(msg)
        raise RuntimeError(f"direct HTTP {direct['status']}")
    _assert(isinstance(direct.get("json"), dict) and isinstance(direct["json"].get("reply"), str), f"direct: missing reply (got {direct['textPreview']})")
    _assert(isinstance(direct["json"].get("actions"), list), "direct: missing actions[]")
    if args.require_http:
        transport = direct["json"].get("debug", {}).get("transport")
        err = direct["json"].get("debug", {}).get("error")
        _assert(
            transport == "http",
            f"direct: transport={transport!r}{(' error=' + repr(err)) if err else ''}",
        )

    # Image (optional)
    if args.include_image:
        img = _request_json(
            opener,
            "POST",
            f"{base}/api/asset/image/generate",
            {
                "prompt": "Cinematic environment concept art, sunrise. No text. No watermark.",
                "aspectRatio": "16:9",
                "settings": {"provider": "gemini", "model": "nano-banana-pro", "temperature": 0.4},
            },
            args.timeout_s,
        )
        results.append({"name": "image.generate", **{k: img[k] for k in ["url", "ms", "status", "ok", "textPreview"]}, "debug": (img.get("json") or {}).get("debug")})
        _assert(img["ok"], f"image.generate HTTP {img['status']}")
        _assert(isinstance(img.get("json"), dict) and isinstance(img["json"].get("imageUrl"), str), f"image.generate: missing imageUrl (got {img['textPreview']})")
        image_url = img["json"]["imageUrl"]
        if args.require_http:
            transport = img["json"].get("debug", {}).get("transport")
            err = img["json"].get("debug", {}).get("error")
            _assert(
                transport == "http",
                f"image.generate: transport={transport!r}{(' error=' + repr(err)) if err else ''}",
            )
            _assert(
                image_url.startswith("/__generated__/"),
                f"image.generate: expected local /__generated__/ URL (got {image_url})",
            )
        if image_url.startswith("/__generated__/"):
            fetched = _head(opener, f"{base}{image_url}", args.timeout_s)
            results.append({"name": "image.fetch", **fetched})
            _assert(fetched["ok"], f"image.fetch HTTP {fetched['status']}")
            _assert(str(fetched.get("contentType", "")).startswith("image/"), f"image.fetch: content-type={fetched.get('contentType')}")

    print(_pretty({"base": base, "requireHttp": args.require_http, "includeImage": args.include_image, "results": results}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Exception as e:
        sys.stderr.write(f"{e}\n")
        raise SystemExit(1)
