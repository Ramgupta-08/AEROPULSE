from __future__ import annotations

import json
import math
from collections import defaultdict
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, delete, select

from app.core.auth import DEMO_USERS, Role, require
from app.core.db import get_session
from app.models import HangarBay, Meta, ScheduleBlock
from app.services import planning as P
from app.services.hashchain import append
from app.services.scheduler import optimise

router = APIRouter(prefix="/api/schedule", tags=["planner"])
PLAN = "aeropulse"


def _plan_meta(session: Session) -> dict | None:
    m = session.get(Meta, "plan")
    return json.loads(m.value) if m else None


def _save_meta(session: Session, data: dict) -> None:
    m = session.get(Meta, "plan") or Meta(key="plan", value="{}")
    m.value = json.dumps(data)
    session.add(m)


def compare(session: Session, state: P.PlanState | None = None) -> dict:
    state = state or P.load_state(session)
    blocks = P.active_plan(session, PLAN)
    react_down, react_visits = P.simulate_reactive(state)
    reactive = P.summarise(state, react_down)
    unplanned_r = sum(1 for v in react_visits if v["source"] == "predicted")
    out = {
        "horizon_days": P.HORIZON,
        "dates": [(state.as_of + timedelta(days=d)).isoformat() for d in range(P.HORIZON)],
        "reactive": {**reactive, "in_service_failures": unplanned_r, "visits": len(react_visits)},
        "aeropulse": None,
    }
    if blocks:
        down = P.plan_downtime(state, blocks)
        ap = P.summarise(state, down)
        fails = sum(1 for iv in down.values() for x in iv if x[2] != "planned")
        out["aeropulse"] = {**ap, "in_service_failures": fails, "visits": len(blocks)}
        fc_r = P.forecast(state, None)["types"]
        fc_a = P.forecast(state, blocks)["types"]
        out["by_type"] = {
            k: {"reactive": fc_r[k]["p50"], "aeropulse": fc_a[k]["p50"], "demand": fc_a[k]["demand"]} for k in fc_a
        }
        out["delta"] = {
            "avg_readiness_pts": round(ap["avg_readiness_pct"] - reactive["avg_readiness_pct"], 1),
            "downtime_avoided_aircraft_days": reactive["downtime_aircraft_days"] - ap["downtime_aircraft_days"],
            "failures_avoided": unplanned_r - fails,
            "missions_recovered": reactive["missions_short"] - ap["missions_short"],
            "min_mc_gain": ap["min_mc"] - reactive["min_mc"],
        }
    return out


class OptimiseOut(BaseModel):
    plan: dict
    blocks: list[dict]
    compare: dict


@router.post("/optimise", response_model=OptimiseOut)
def run_optimise(
    mission_aware: bool = True,
    bundling_window_days: int = Query(20, ge=0, le=45),
    role: Role = Depends(require("schedule_write")),
    session: Session = Depends(get_session),
) -> OptimiseOut:
    state = P.load_state(session, window=bundling_window_days)
    res = optimise(state, mission_aware=mission_aware, window=bundling_window_days, bundling=bundling_window_days > 0)
    if not res["blocks"]:
        raise HTTPException(422, f"Solver returned {res['status']}")
    session.exec(delete(ScheduleBlock).where(ScheduleBlock.plan == PLAN))
    for b in res["blocks"]:
        session.add(
            ScheduleBlock(
                plan=PLAN,
                tail=b["tail"],
                base_id=b["base_id"],
                bay_id=b["bay_id"],
                start_day=b["start_day"],
                duration_days=b["duration_days"],
                tasks=b["tasks"],
                bundled_count=b["bundled_count"],
                locked=b["locked"],
            )
        )
    meta = {
        "status": res["status"],
        "objective": res["objective"],
        "min_mc": res["min_mc"],
        "solve_seconds": res["solve_seconds"],
        "mission_aware": mission_aware,
        "bundling": res["bundling"],
        "late_visits": res["late_visits"],
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "created_by": DEMO_USERS[role],
    }
    _save_meta(session, meta)
    append(
        session,
        actor=DEMO_USERS[role],
        role=role.value,
        action="schedule.optimise",
        entity_type="plan",
        entity_id=PLAN,
        summary=f"Optimised plan: {len(res['blocks'])} visits, {res['bundling']['bundled_tasks']} tasks bundled ({'mission-aware' if mission_aware else 'readiness only'})",
        payload={k: meta[k] for k in ("status", "min_mc", "mission_aware", "late_visits")}
        | {"visits": len(res["blocks"])},
    )
    session.commit()
    return OptimiseOut(plan=meta, blocks=P.active_plan(session, PLAN), compare=compare(session, state))


@router.get("", dependencies=[Depends(require("schedule"))])
def get_schedule(session: Session = Depends(get_session)) -> dict:
    state = P.load_state(session)
    blocks = P.active_plan(session, PLAN)
    planned = {t["id"] for b in blocks for t in b["tasks"]}
    bays = session.exec(select(HangarBay).order_by(HangarBay.base_id, HangarBay.id)).all()
    names = {ah.base.id: ah.base.name for ah in state.fleet}
    return {
        "as_of": state.as_of.isoformat(),
        "horizon_days": P.HORIZON,
        "dates": [(state.as_of + timedelta(days=d)).isoformat() for d in range(P.HORIZON)],
        "plan": _plan_meta(session) if blocks else None,
        "bays": [
            {"id": b.id, "base_id": b.base_id, "base_name": names.get(b.base_id, b.base_id), "name": b.name}
            for b in bays
        ],
        "blocks": blocks,
        "missions": [
            {
                "id": m.id,
                "name": m.name,
                "start_day": (m.start_date - state.as_of).days,
                "end_day": (m.end_date - state.as_of).days,
                "base_id": m.base_id,
                "scope": m.scope,
                "aircraft_type": m.aircraft_type,
                "required": m.required_count,
                "priority": m.priority,
            }
            for m in state.missions
            if (m.end_date - state.as_of).days >= 0 and (m.start_date - state.as_of).days < P.HORIZON
        ],
        "pending_tasks": [t.as_dict() for t in sorted(state.tasks, key=lambda t: t.due_day) if t.id not in planned],
        "transfers": state.transfers,
    }


@router.get("/compare", dependencies=[Depends(require("schedule"))])
def get_compare(session: Session = Depends(get_session)) -> dict:
    return compare(session)


@router.post("/reset")
def reset(role: Role = Depends(require("schedule_write")), session: Session = Depends(get_session)) -> dict:
    n = len(session.exec(select(ScheduleBlock).where(ScheduleBlock.plan == PLAN)).all())
    session.exec(delete(ScheduleBlock).where(ScheduleBlock.plan == PLAN))
    m = session.get(Meta, "plan")
    if m:
        session.delete(m)
    if n:
        append(
            session,
            actor=DEMO_USERS[role],
            role=role.value,
            action="schedule.reset",
            entity_type="plan",
            entity_id=PLAN,
            summary=f"Plan cleared ({n} visits)",
            payload={"visits_removed": n},
        )
    session.commit()
    return {"removed": n}


class MoveIn(BaseModel):
    start_day: int
    bay_id: str | None = None
    force: bool = False
    dry_run: bool = False


def validate(session: Session, block: dict, blocks: list[dict], state: P.PlanState) -> list[dict]:
    """Re-check every hard constraint for a moved visit, plus its mission impact."""
    issues = []
    s, e = block["start_day"], block["start_day"] + block["duration_days"]
    if block["locked"] and s != 0:
        issues.append(
            {
                "level": "error",
                "type": "locked",
                "message": "Work is already in progress on this aircraft; it cannot be moved.",
            }
        )
    non_wo = [t for t in block["tasks"] if t.get("source") not in ("work-order", "scenario")]
    if non_wo:
        due = min(t["due_day"] for t in non_wo)
        if s > due:
            worst = min(non_wo, key=lambda t: t["due_day"])
            issues.append(
                {
                    "level": "error",
                    "type": "deadline",
                    "message": f"Starts on day {s}, after the {worst['position']} P10 failure point / limit (day {due}).",
                }
            )
    earliest = max((t.get("earliest_day", 0) for t in block["tasks"]), default=0)
    if s < earliest:
        src = next((t.get("part_source") for t in block["tasks"] if t.get("earliest_day", 0) == earliest), "")
        issues.append(
            {"level": "error", "type": "parts", "message": f"Parts not on site until day {earliest} ({src})."}
        )
    same_bay = [
        b
        for b in blocks
        if b["id"] != block["id"]
        and b["bay_id"] == block["bay_id"]
        and b["start_day"] < e
        and b["start_day"] + b["duration_days"] > s
    ]
    for b in same_bay:
        issues.append(
            {
                "level": "error",
                "type": "bay",
                "message": f"{block['bay_id']} is occupied by {b['tail']} (days {b['start_day']}–{b['start_day'] + b['duration_days'] - 1}).",
            }
        )
    # Technician hours per day at this base
    load: dict[tuple[str, int], float] = defaultdict(float)
    for b in [*[x for x in blocks if x["id"] != block["id"]], block]:
        if b["base_id"] != block["base_id"]:
            continue
        per_trade: dict[str, float] = defaultdict(float)
        for t in b["tasks"]:
            per_trade[t.get("trade", "airframe")] += t.get("man_hours", 0)
        for trade, mh in per_trade.items():
            for d in range(b["start_day"], b["start_day"] + b["duration_days"]):
                load[(trade, d)] += math.ceil(mh / b["duration_days"])
    for (trade, d), h in sorted(load.items()):
        cap = state.trade_hours.get((block["base_id"], trade), 48)
        if s <= d < e and h > cap:
            issues.append(
                {
                    "level": "error",
                    "type": "technicians",
                    "message": f"{trade.capitalize()} technicians over capacity on day {d}: {h:.0f} h needed, {cap:.0f} h available.",
                }
            )
            break
    before = P.summarise(state, P.plan_downtime(state, blocks))
    after_blocks = [block if b["id"] == block["id"] else b for b in blocks]
    after = P.summarise(state, P.plan_downtime(state, after_blocks))
    worse = [a for a, b0 in zip(after["missions"], before["missions"], strict=True) if a["shortfall"] > b0["shortfall"]]
    for w in worse:
        issues.append(
            {
                "level": "warning",
                "type": "mission",
                "message": f"{w['name']} drops to {w['available']} of {w['required']} aircraft.",
            }
        )
    if after["min_mc"] < before["min_mc"]:
        issues.append(
            {
                "level": "warning",
                "type": "readiness",
                "message": f"Minimum daily readiness falls from {before['min_mc']} to {after['min_mc']} aircraft.",
            }
        )
    return issues


@router.patch("/{block_id}")
def move_block(
    block_id: int,
    body: MoveIn,
    role: Role = Depends(require("schedule_write")),
    session: Session = Depends(get_session),
) -> dict:
    row = session.get(ScheduleBlock, block_id)
    if row is None or row.plan != PLAN:
        raise HTTPException(404, "Block not found")
    state = P.load_state(session)
    blocks = P.active_plan(session, PLAN)
    current = next(b for b in blocks if b["id"] == block_id)
    bay_id = body.bay_id or row.bay_id
    bay = session.get(HangarBay, bay_id)
    if bay is None or bay.base_id != row.base_id:
        raise HTTPException(422, "A visit can only move between bays of its own base.")
    moved = {**current, "start_day": max(0, min(P.HORIZON - 1, body.start_day)), "bay_id": bay_id}
    issues = validate(session, moved, blocks, state)
    errors = [i for i in issues if i["level"] == "error"]
    applied = not body.dry_run and (not errors or body.force) and not any(i["type"] == "locked" for i in errors)
    if applied:
        old = (row.start_day, row.bay_id)
        row.start_day, row.bay_id = moved["start_day"], bay_id
        session.add(row)
        append(
            session,
            actor=DEMO_USERS[role],
            role=role.value,
            action="schedule.move",
            entity_type="schedule_block",
            entity_id=str(block_id),
            tail=row.tail,
            summary=f"{row.tail} visit moved from day {old[0]} ({old[1]}) to day {row.start_day} ({row.bay_id})"
            + (" with overrides" if errors else ""),
            payload={"from": list(old), "to": [row.start_day, row.bay_id], "overridden": [i["type"] for i in errors]},
        )
        session.commit()
    return {"applied": applied, "issues": issues, "block": moved}
