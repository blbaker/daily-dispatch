#!/usr/bin/env bash
# digest_collect.sh — feed the day's captured links to the digest-writing step.
# Prints the pending links (JSONL) to stdout, then rotates the store into a
# timestamped archive so nothing is digested twice. If there are no links,
# prints NO_LINKS and rotates nothing.
#
# ROTATION SAFETY: rotating (mv) the store CONSUMES the day's links, so a
# manual test run would eat whatever is pending. Only your scheduled run
# should rotate. Set DIGEST_PEEK=1 for test/manual runs to read the links
# WITHOUT rotating.
set -euo pipefail

DATA_DIR="${DAILY_DISPATCH_HOME:-$HOME/.daily-dispatch}"
STORE="${DAILY_DISPATCH_LINK_STORE:-$DATA_DIR/links.jsonl}"
ARCHIVE_DIR="${DAILY_DISPATCH_ARCHIVE_DIR:-$DATA_DIR/archive}"
WEB_DIR="${DAILY_DISPATCH_WEB_DIR:-$DATA_DIR/web}"
STAMP="$(date +%Y-%m-%d)"
mkdir -p "$ARCHIVE_DIR"

if [[ ! -s "$STORE" ]]; then
  echo "NO_LINKS"
  exit 0
fi

if [[ "${DIGEST_PEEK:-0}" == "1" ]]; then
  # Peek mode: read the live store in place, do NOT rotate/consume.
  COUNT="$(wc -l < "$STORE" | tr -d ' ')"
  echo "PENDING_LINKS=$COUNT"
  echo "ARCHIVE_FILE=(peek — not rotated)"
  echo "WEB_DIR=$WEB_DIR"
  echo "---LINKS---"
  cat "$STORE"
  exit 0
fi

# Move first (atomic), then read the archived copy — so links pushed mid-run
# land in the fresh store and aren't lost.
ARCHIVED="$ARCHIVE_DIR/links-$STAMP-$(date +%H%M%S).jsonl"
mv "$STORE" "$ARCHIVED"

COUNT="$(wc -l < "$ARCHIVED" | tr -d ' ')"
echo "PENDING_LINKS=$COUNT"
echo "ARCHIVE_FILE=$ARCHIVED"
echo "WEB_DIR=$WEB_DIR"
echo "---LINKS---"
cat "$ARCHIVED"
