"""Shared configuration for the Daily Dispatch pipeline scripts.

Everything here is a path, URL, or identity that used to be hardcoded to one
person's machine. It is now an environment variable with a neutral default,
so a fresh checkout works for anyone without editing code. See
.env.pipeline.example at the repo root for the full list with comments.
"""
import os
from pathlib import Path


def _path(env_var: str, default: Path) -> Path:
    raw = os.environ.get(env_var)
    return Path(raw).expanduser() if raw else default


HOME = Path.home()

# Base directory for everything the pipeline writes: captured links, the
# rendered web app, archives, and caches. One env var moves the whole thing.
DATA_DIR = _path("DAILY_DISPATCH_HOME", HOME / ".daily-dispatch")

LINK_STORE = _path("DAILY_DISPATCH_LINK_STORE", DATA_DIR / "links.jsonl")
ARCHIVE_DIR = _path("DAILY_DISPATCH_ARCHIVE_DIR", DATA_DIR / "archive")
WEB_DIR = _path("DAILY_DISPATCH_WEB_DIR", DATA_DIR / "web")
IMG_CACHE = DATA_DIR / "img-cache.json"
SCRAPE_CACHE = DATA_DIR / "scrape-cache.json"
PUSH_LOCK = DATA_DIR / ".push.lock"
LIVE_PUSH_LOG = DATA_DIR / "live-push.log"

# Backend API (the CDK stack's Lambda Function URL + its API key). Set these
# as real env vars, or point DAILY_DISPATCH_SECRETS_DIR at a directory
# holding "api-url" and "api-key" files (handy for a systemd/cron setup
# where you don't want secrets in the process environment).
SECRETS_DIR = _path("DAILY_DISPATCH_SECRETS_DIR", DATA_DIR / "secrets")


def digest_api_conf() -> tuple[str, str]:
    """(base_url, api_key) for the backend, or ("", "") if unconfigured."""
    url = os.environ.get("DIGEST_API_URL", "")
    key = os.environ.get("DIGEST_API_KEY", "")
    if not url and (SECRETS_DIR / "api-url").exists():
        url = (SECRETS_DIR / "api-url").read_text().strip()
    if not key and (SECRETS_DIR / "api-key").exists():
        key = (SECRETS_DIR / "api-key").read_text().strip()
    return url.rstrip("/"), key


# Podcast framing: the two hosts talk about links sent in by one listener.
# Defaults are neutral so a fresh checkout doesn't talk about Baker.
LISTENER_NAME = os.environ.get("LISTENER_NAME", "a listener")
LISTENER_TOWN = os.environ.get("LISTENER_TOWN", "out there somewhere")

# Optional self-hosted Firecrawl (or compatible) instance for JS-heavy pages
# the plain fetch can't read. Leave unset to skip that fallback entirely.
FIRECRAWL_URL = os.environ.get("FIRECRAWL_URL", "")

# Command used to write article summaries. Must accept the prompt as its
# final argument and print the response to stdout. Defaults to the Claude
# Code CLI; set SUMMARIZE_CMD to point at any other CLI that behaves the
# same way (including a local hermes install, if you have one).
SUMMARIZE_CMD = os.environ.get("SUMMARIZE_CMD", "claude -p")

# Local Ollama fallback if SUMMARIZE_CMD fails or isn't installed.
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434/api/generate")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.1:8b")
