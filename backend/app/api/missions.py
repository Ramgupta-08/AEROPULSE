from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.core.auth import require
from app.core.db import get_session
from app.models import Base
from app.services import planning as P

router = APIRouter(prefix="/api", tags=["missions"])


def _status(m: dict) -> str:
    if m["shortfall"] == 0:
        return "ready" if m["available"] - m["required"] >= 1 or m["required"] <= 1 else "caution"
    return "grounded"


def missions_with_coverage(session: Session, base_id: str | None = None) -> tuple[str, list[dict]]:
    state = P.load_state(session)
    blocks = P.active_plan(session)
    down = P.plan_downtime(state, blocks) if blocks else P.simulate_reactive(state)[0]
    mc = P.mc_matrix(state, down, P.FORECAST_DAYS)
    cov = {c["mission_id"]: c for c in P.mission_shortfalls(state, mc, P.FORECAST_DAYS)}
    names = {b.id: b.name for b in session.exec(select(Base)).all()}
    out = []
    for m in state.missions:
        if base_id and m.scope == "base" and m.base_id != base_id:
            continue
        c = cov.get(m.id)
        row = {
            "id": m.id,
            "name": m.name,
            "kind": m.kind,
            "base_id": m.base_id,
            "base_name": names[m.base_id],
            "aircraft_type": m.aircraft_type,
            "required": m.required_count,
            "start_date": m.start_date.isoformat(),
            "end_date": m.end_date.isoformat(),
            "start_day": (m.start_date - state.as_of).days,
            "end_day": (m.end_date - state.as_of).days,
            "priority": m.priority,
            "scope": m.scope,
        }
        if c:
            row.update(
                available=c["available"],
                shortfall=c["shortfall"],
                worst_day=c["worst_day"],
                status=_status(c),
                in_forecast=True,
            )
        else:
            row.update(available=None, shortfall=None, worst_day=None, status="info", in_forecast=False)
        out.append(row)
    return ("aeropulse" if blocks else "reactive"), out


@router.get("/missions", dependencies=[Depends(require("missions"))])
def list_missions(base_id: str | None = None, session: Session = Depends(get_session)) -> dict:
    plan, rows = missions_with_coverage(session, base_id)
    return {"plan": plan, "missions": rows}


@router.get("/missions/{mission_id}/coverage", dependencies=[Depends(require("missions"))])
def mission_coverage(mission_id: str, session: Session = Depends(get_session)) -> dict:
    """Can we support this mission? Which aircraft are available, and what maintenance would have to move."""
    state = P.load_state(session)
    m = next((x for x in state.missions if x.id == mission_id), None)
    if m is None:
        raise HTTPException(404, "Mission not found")
    blocks = P.active_plan(session)
    down = P.plan_downtime(state, blocks) if blocks else P.simulate_reactive(state)[0]
    s = max(0, (m.start_date - state.as_of).days)
    e = (m.end_date - state.as_of).days
    days = max(P.FORECAST_DAYS, e + 1)
    mc = P.mc_matrix(state, down, days)
    window = range(s, min(days, e + 1))
    candidates, blocked = [], []
    for ah in state.fleet:
        a = ah.aircraft
        if a.type != m.aircraft_type or (m.scope == "base" and a.base_id != m.base_id):
            continue
        ok = all(mc[a.tail][d] for d in window)
        conflicts = [iv for iv in down.get(a.tail, []) if iv[0] <= e and iv[1] > s]
        row = {
            "tail": a.tail,
            "base_id": a.base_id,
            "status": ah.status,
            "health": ah.health,
            "conflicts": [{"start_day": c[0], "end_day": c[1], "reason": c[2]} for c in conflicts],
        }
        (candidates if ok else blocked).append(row)
    movable = []
    for b in blocks:
        if (
            b["tail"] in {x["tail"] for x in blocked}
            and b["start_day"] <= e
            and b["start_day"] + b["duration_days"] > s
        ):
            latest = min((x.get("due_day", 99) for x in b["tasks"]), default=99)
            movable.append(
                {
                    "tail": b["tail"],
                    "block_id": b["id"],
                    "start_day": b["start_day"],
                    "duration_days": b["duration_days"],
                    "can_move_before": latest >= 0 and b["duration_days"] <= s,
                    "can_defer_after": latest > e,
                    "tasks": [x["title"] for x in b["tasks"]],
                }
            )
    return {
        "mission": {
            "id": m.id,
            "name": m.name,
            "required": m.required_count,
            "start_date": m.start_date.isoformat(),
            "end_date": m.end_date.isoformat(),
            "aircraft_type": m.aircraft_type,
            "base_id": m.base_id,
            "scope": m.scope,
            "date_range": [(state.as_of + timedelta(days=s)).isoformat(), m.end_date.isoformat()],
        },
        "available": len(candidates),
        "supportable": len(candidates) >= m.required_count,
        "candidates": sorted(candidates, key=lambda r: -r["health"]),
        "blocked": blocked,
        "movable_maintenance": movable,
    }
