from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import aircraft, fleet, health, kpi, meta, missions, schedule, whatif
from app.core.db import init_db

log = logging.getLogger("aeropulse")


def _warm_caches() -> None:
    """Build engine tracks (feature windows + quantile predictions) once, off the request path."""
    from sqlmodel import Session

    from app.core.db import get_engine
    from app.services import health, rul

    if not rul.models_ready():
        return
    try:
        from app.api.health import engines

        with Session(get_engine()) as s:
            health.fleet(s)
            engines(session=s)  # SHAP reasons + anomaly scores
    except Exception:  # pragma: no cover - empty or unseeded database
        log.warning("Cache warm-up skipped (database not seeded?)")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    threading.Thread(target=_warm_caches, daemon=True).start()
    yield


app = FastAPI(
    title="AeroPulse API",
    version="0.1.0",
    description=(
        "Predictive maintenance & fleet availability platform (SIH26249). "
        "Integration-ready REST + WebSocket API. All fleet data is simulated."
    ),
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (
    meta.router,
    fleet.router,
    aircraft.router,
    aircraft.ws_router,
    health.router,
    kpi.router,
    missions.router,
    schedule.router,
    whatif.router,
):
    app.include_router(r)
