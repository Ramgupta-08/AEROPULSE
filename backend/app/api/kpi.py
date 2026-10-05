from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app.core.auth import require
from app.core.db import get_session
from app.services import kpi as K
from app.services import planning as P

router = APIRouter(prefix="/api", tags=["kpi"])


@router.get("/kpi/overview", dependencies=[Depends(require("overview"))])
def kpi_overview(base_id: str | None = None, session: Session = Depends(get_session)) -> dict:
    out = K.overview(session, base_id)
    out.pop("history")
    return out


@router.get("/forecast", dependencies=[Depends(require("overview"))])
def readiness_forecast(
    plan: str = Query("auto", pattern="^(auto|reactive|aeropulse)$"), session: Session = Depends(get_session)
) -> dict:
    """30-day mission-capable forecast with P10/P90 band and mission demand, per aircraft type."""
    state = P.load_state(session)
    blocks = P.active_plan(session) if plan in ("auto", "aeropulse") else []
    used = "aeropulse" if blocks else "reactive"
    f = P.forecast(state, blocks or None)
    f.pop("mc_p50")
    return {"plan": used, **f}


@router.get("/alerts", dependencies=[Depends(require("overview"))])
def priority_alerts(limit: int = 12, session: Session = Depends(get_session)) -> list[dict]:
    return K.alerts(session, limit=limit)
