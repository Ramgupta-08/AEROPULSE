#!/usr/bin/env bash
# Starts the AeroPulse API and web app together. Ctrl-C stops both.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PY=backend/.venv/bin/python
if [ -f backend/app/ml/train_rul.py ] && [ ! -f backend/app/ml/artifacts/rul_FD001.joblib ]; then
  echo "▸ First run: training RUL models (one-off)"
  (cd backend && .venv/bin/python -m app.ml.train_rul)
fi
if [ -f backend/app/seed/generate.py ] && [ ! -f data/aeropulse.db ]; then
  echo "▸ First run: generating simulated fleet database"
  (cd backend && .venv/bin/python -m app.seed.generate)
fi

pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; wait 2>/dev/null || true; }
trap cleanup EXIT INT TERM

(cd backend && exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 ${AEROPULSE_RELOAD:+--reload}) &
pids+=($!)
(cd frontend && exec npx vite --host 0.0.0.0 --port 5173 --strictPort) &
pids+=($!)

echo ""
echo "  AeroPulse  →  http://localhost:5173"
echo "  API docs   →  http://localhost:8000/docs"
echo ""
wait -n "${pids[@]}"
