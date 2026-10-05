#!/usr/bin/env bash
# Boots the app if it isn't running, then captures/smoke-tests every page with Playwright.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
started=""
if ! curl -sf http://127.0.0.1:5173 >/dev/null 2>&1; then
  bash scripts/dev.sh >/tmp/aeropulse-dev.log 2>&1 &
  started=$!
  for _ in $(seq 1 90); do curl -sf http://127.0.0.1:5173/api/ping >/dev/null 2>&1 && break; sleep 1; done
fi
status=0
node frontend/scripts/screenshots.mjs "$@" || status=$?
if [ -n "$started" ]; then kill "$started" 2>/dev/null || true; pkill -f "uvicorn app.main:app" 2>/dev/null || true; pkill -f "vite --host" 2>/dev/null || true; fi
exit $status
