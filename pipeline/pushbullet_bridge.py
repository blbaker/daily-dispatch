#!/usr/bin/env python3
"""Pushbullet -> Daily Dispatch link bridge (the listener).

Listens to the Pushbullet realtime websocket. When a new push arrives that
contains a URL (a link push, or a note/text whose body/url has an http(s)
link), it appends the link to the local store and rebuilds the live "Today"
view of the app.

Required: PUSHBULLET_TOKEN env var (your own Pushbullet access token, from
https://www.pushbullet.com/#settings/account -- never hardcode it).

Optional forwarding: if you also run a webhook that wants to know about new
links immediately (chat bot, automation, etc.), set LINK_WEBHOOK_URL to
its URL and LINK_WEBHOOK_SECRET to sign the request. Leave both unset
to just capture links locally.
"""
import hashlib
import hmac
import json
import os
import re
import sys
import time
import urllib.request

import config

# websocket-client is only needed to actually run the listener (main()), not
# to import this module -- keeps `pipeline.pushbullet_bridge` importable for
# tests and for other scripts that reuse _existing_urls()/_save() without
# requiring that dependency or a real PUSHBULLET_TOKEN.
PB_TOKEN = os.environ.get("PUSHBULLET_TOKEN", "").strip()
WEBHOOK_URL = os.environ.get("LINK_WEBHOOK_URL", "")
WEBHOOK_SECRET = os.environ.get("LINK_WEBHOOK_SECRET", "").strip()
LINK_STORE = config.LINK_STORE
API = "https://api.pushbullet.com/v2"
URL_RE = re.compile(r"https?://[^\s\"'<>]+")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

_last_seen = time.time()


def _api_get(path):
    req = urllib.request.Request(f"{API}{path}",
                                 headers={"Access-Token": PB_TOKEN})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def _extract_url(push):
    # explicit link push
    if push.get("url"):
        return push["url"].strip()
    # note/text with a link in the body or title
    for field in ("body", "title"):
        m = URL_RE.search(push.get(field, "") or "")
        if m:
            return m.group(0)
    return None


def _existing_urls():
    """URLs already in today's store, to dedupe backfill against live captures."""
    urls = set()
    try:
        with open(LINK_STORE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    urls.add(json.loads(line).get("url", ""))
                except Exception:
                    pass
    except FileNotFoundError:
        pass
    return urls


def _save(url, push):
    """Append the link to the digest store so the daily digest job can
    build the digest. Failure here must never block the instant forward. Skips URLs
    already in the store so a startup backfill can't duplicate a live
    capture."""
    try:
        os.makedirs(os.path.dirname(LINK_STORE), exist_ok=True)
        if url in _existing_urls():
            print(f"skip dup {url}", flush=True)
            return
        rec = {
            "url": url,
            "title": (push.get("title") or "").strip(),
            "body": (push.get("body") or "").strip(),
            "captured_at": time.time(),
            "captured_iso": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        }
        with open(LINK_STORE, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        print(f"saved {url} -> digest store", flush=True)
        _rebuild_app()
    except Exception as e:
        print(f"save FAILED {url}: {e}", file=sys.stderr, flush=True)


def _rebuild_app():
    """Regenerate the archive app so the live 'Today' edition reflects the
    link just saved. Best-effort: never let a rebuild failure break the
    bridge."""
    try:
        import subprocess
        builder = os.path.join(SCRIPT_DIR, "build_ynd_app.py")
        subprocess.run(["python3", builder], timeout=30,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print("rebuilt archive app", flush=True)
    except Exception as e:
        print(f"app rebuild skipped: {e}", file=sys.stderr, flush=True)
    _push_live()


def _push_live():
    """Push the in-progress edition to the Daily Dispatch API so the app's
    Today tab updates the moment a link lands. Detached + best-effort: the
    page fetch can take ~20s and must never block the Pushbullet websocket.
    No-ops quietly if DIGEST_API_URL/DIGEST_API_KEY aren't configured."""
    base, key = config.digest_api_conf()
    if not base or not key:
        return
    try:
        import subprocess
        pusher = os.path.join(SCRIPT_DIR, "push_to_api.py")
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        log = open(config.LIVE_PUSH_LOG, "a")
        subprocess.Popen(["python3", pusher, "--live"], stdout=log, stderr=log,
                         start_new_session=True)
        print("live edition push started", flush=True)
    except Exception as e:
        print(f"live push skipped: {e}", file=sys.stderr, flush=True)


def _forward(url):
    if not WEBHOOK_URL:
        return
    payload = json.dumps({"url": url}).encode()
    headers = {"Content-Type": "application/json"}
    if WEBHOOK_SECRET:
        ts = str(int(time.time()))
        sig = hmac.new(WEBHOOK_SECRET.encode(),
                       ts.encode() + b"." + payload, hashlib.sha256).hexdigest()
        headers["X-Webhook-Timestamp"] = ts
        headers["X-Webhook-Signature-V2"] = sig
    req = urllib.request.Request(WEBHOOK_URL, data=payload, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            print(f"forwarded {url} -> {r.status}", flush=True)
    except Exception as e:
        print(f"forward FAILED {url}: {e}", file=sys.stderr, flush=True)


def _drain_new(forward=True):
    global _last_seen
    data = _api_get(f"/pushes?modified_after={_last_seen}&active=true")
    pushes = sorted(data.get("pushes", []), key=lambda p: p.get("modified", 0))
    for p in pushes:
        _last_seen = max(_last_seen, p.get("modified", _last_seen))
        if p.get("dismissed"):
            continue
        url = _extract_url(p)
        if url:
            _save(url, p)
            if forward:
                _forward(url)


def on_message(ws, message):
    try:
        msg = json.loads(message)
    except Exception:
        return
    if msg.get("type") == "tickle" and msg.get("subtype") == "push":
        _drain_new()


def on_error(ws, error):
    print(f"ws error: {error}", file=sys.stderr, flush=True)


def on_close(ws, *a):
    print("ws closed", file=sys.stderr, flush=True)


def main():
    global _last_seen
    if not PB_TOKEN:
        print("FATAL: PUSHBULLET_TOKEN not set", file=sys.stderr)
        return 1
    import websocket  # websocket-client; only needed to actually run the listener

    # Backfill: catch links pushed earlier today that a restart would
    # otherwise miss. Start from local midnight and drain once; _save
    # dedupes against anything already captured live.
    now = time.localtime()
    midnight = time.mktime((now.tm_year, now.tm_mon, now.tm_mday,
                            0, 0, 0, 0, 0, -1))
    _last_seen = midnight
    sink = WEBHOOK_URL or "(no webhook configured, local capture only)"
    print(f"pushbullet-bridge up; sink={sink}; backfilling from "
          f"{time.strftime('%Y-%m-%d 00:00', now)}", flush=True)
    try:
        _drain_new(forward=False)
    except Exception as e:
        print(f"startup backfill error: {e}", file=sys.stderr, flush=True)
    while True:
        try:
            ws = websocket.WebSocketApp(
                f"wss://stream.pushbullet.com/websocket/{PB_TOKEN}",
                on_message=on_message, on_error=on_error, on_close=on_close)
            ws.run_forever(ping_interval=30, ping_timeout=10)
        except Exception as e:
            print(f"loop error: {e}", file=sys.stderr, flush=True)
        time.sleep(5)  # reconnect backoff


if __name__ == "__main__":
    raise SystemExit(main())
