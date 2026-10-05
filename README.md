# AeroPulse

**Air Power – Predictive Maintenance & Fleet Availability** · Smart India Hackathon 2026 · SIH26249 (Ministry of Defence)

> AeroPulse turns air-fleet maintenance from reactive to predictive — it unifies scattered data, predicts failures
> with reasons and confidence, and plans maintenance around missions so the maximum number of aircraft are ready to fly.

## Quick start

```bash
make dev        # first run: creates envs, trains models, seeds data — then serves
# open http://localhost:5173   (API docs: http://localhost:8000/docs)
```

Requirements: Python 3.11, Node 20+, `make` (`uv` optional, used if present). Runs fully offline after setup.

| Command | Purpose |
|---|---|
| `make dev` | API + web app |
| `make seed` | Regenerate the simulated fleet |
| `make train` | Train RUL models on NASA C-MAPSS |
| `make test` | Backend + frontend checks |
| `make screenshots` | Playwright screenshots of every page |

> Build in progress — see `CLAUDE.md` for structure and conventions.
