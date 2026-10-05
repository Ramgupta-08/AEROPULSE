# AeroPulse — working notes for Claude

Predictive maintenance & fleet availability prototype for SIH 2026 problem **SIH26249** (Ministry of Defence).
Pitch: turn air-fleet maintenance from reactive to predictive — unify data, predict failures with reasons and
confidence, and plan maintenance around missions so the maximum number of aircraft are ready to fly.

## Stack
- **Backend** (`backend/`): Python 3.11, FastAPI, SQLModel on SQLite (`data/aeropulse.db`, keep Postgres-compatible),
  WebSockets for telemetry, LightGBM quantile RUL + SHAP, IsolationForest, OR-Tools CP-SAT, scikit-learn TF-IDF.
  Optional Claude via `ANTHROPIC_API_KEY` — every LLM feature has an offline fallback.
- **Frontend** (`frontend/`): React 18 + TypeScript + Vite, Tailwind 3.4 with token-driven theme, Radix primitives
  (hand-written shadcn-style components in `src/components/ui`), TanStack Query, Zustand, React Router,
  ECharts (all charts), MapLibre (offline GeoJSON, no tile server), lucide-react icons, Framer Motion.

## Commands
| Command | What it does |
|---|---|
| `make dev` | Sets up envs if needed, trains + seeds on first run, runs API :8000 and web :5173 |
| `make seed` | Regenerate the deterministic simulated fleet DB |
| `make train` | Train RUL quantile models + anomaly detector, write `backend/app/ml/artifacts/metrics.json` |
| `make test` | ruff + pytest, then `tsc`, ESLint, Vitest |
| `make screenshots` | Playwright screenshots of every page (1440×900, 390×844, dark + light) → `frontend/screenshots/` |
| `make smoke` | Playwright: every route renders, no console errors, no horizontal overflow |

Backend venv: `backend/.venv` (created with `uv`). Run single tests with `cd backend && .venv/bin/python -m pytest -q tests/test_x.py`.

## Layout
```
backend/app/
  main.py            FastAPI app, router registration
  core/              config (paths, settings), db (engine/session), auth (roles, require(area))
  api/               one router per feature area (prefix /api/...)
  models/            SQLModel tables (fleet, maintenance, logistics, planning, audit)
  services/          domain logic (rul, anomaly, scheduler, bundling, whatif, spares, copilot, hashchain, ...)
  ml/train_rul.py    training; artifacts/ holds models + metrics.json
  seed/generate.py   deterministic fleet generator; manuals/ = fictional manual sections for Copilot RAG
backend/tests/       pytest; `client` fixture uses an isolated in-memory DB
frontend/src/
  app/               router (App.tsx) and nav registry (nav.ts: path, area, shortcut)
  components/ui      primitives (Button, Card, StatusPill, KpiTile, DataTable, Drawer, Toast, dialogs ...)
  components/layout  AppShell, Sidebar, TopBar, CommandPalette, RoleGate
  components/charts  Chart (ECharts wrapper, re-themes on toggle), Sparkline
  features/<page>/   one folder per page
  lib/               api client (sends X-Role), store (theme/role/base filter), format, echartsTheme, queries
  styles/tokens.css  ALL colours as RGB-triplet CSS variables, dark + light
data/cmapss/         NASA C-MAPSS raw files (downloaded by seed/train; synthetic fallback if unavailable)
```

## Rules
- **Roles are enforced on the API**: every router uses `Depends(require("<area>"))` from `app/core/auth.py`.
  The UI hides nav via `/api/meta` role areas and `RoleGate`. Keep `ACCESS` and `frontend/src/app/nav.ts` in sync.
- **No hard-coded numbers in the UI** — everything comes from the API / seeded DB. Demo narrative values
  (74 % readiness, AP-112 Engine 2 ≈ 18 sorties, HS-2291 batch) must be emergent from `seed/generate.py`.
- Data is **simulated** and must be labelled as such; tail numbers `AP-101…AP-160`, generic types only.
- Must work **offline** after setup: fonts bundled via @fontsource, map GeoJSON is a local file, no CDN calls.
- No placeholder text, lorem ipsum, TODOs, dead buttons or links in the UI.

## Design rules ("calm mission control")
- Colours only via tokens (`bg surface raised border subtle body strong accent ready caution grounded info`);
  tints with `/12`. One accent (`#4C8DFF`) for primary actions/focus only. Status colours only for meaning.
- No gradients, glassmorphism, emoji, heavy shadows. Cards: 1 px border, 10 px radius (`.card`).
- Type scale 12/13/14/16/20/24/32 (`text-xs sm base md lg xl 2xl`). Page title `text-xl font-semibold`,
  KPI numbers `text-2xl font-semibold`, labels `.label` (12px uppercase, 0.04em tracking).
- Tabular numbers everywhere; tail numbers/serials/sensor values use `font-mono`.
- Status always icon + text (`StatusPill`). lucide icons with `strokeWidth={1.75}`.
- Skeletons, not spinners, for page loads. Motion 150–250 ms ease-out; respect reduced motion.
- Verify visually with `make screenshots` at 1440×900 and 390×844 before finishing a UI change.
