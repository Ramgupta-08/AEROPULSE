from __future__ import annotations

import asyncio
import math
from datetime import timedelta

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, Response, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlmodel import Session, func, select

from app.core.auth import ACCESS, require
from app.core.db import get_engine, get_session
from app.models import Aircraft, Component, MaintenanceRecord, Squadron
from app.services import health as H
from app.services import rul as R
from app.services.anomaly import score_engine
from app.services.planning import active_plan

router = APIRouter(prefix="/api", tags=["aircraft"])
ws_router = APIRouter(tags=["telemetry"])


class ComponentBrief(BaseModel):
    id: int
    kind: str
    position: str
    health: float
    tone: str
    rul_unit: str
    p10: float
    p50: float
    p90: float
    p10_days: float
    p50_days: float
    p90_days: float
    life_due_days: float
    due_days: float
    failed: bool


class AircraftRow(BaseModel):
    tail: str
    type: str
    base_id: str
    base_name: str
    squadron: str
    status: str
    status_reason: str
    health: float
    lowest_component: str
    lowest_rul_days: float
    lowest_rul_label: str
    next_due_component: str
    next_due_days: float
    defects_30d: int
    total_hours: float
    total_cycles: int
    sortie_profile: str


def _brief(ch: H.ComponentHealth) -> ComponentBrief:
    return ComponentBrief(
        id=ch.id,
        kind=ch.kind,
        position=ch.position,
        health=ch.health,
        tone=H.tone(ch.health),
        rul_unit=ch.rul_unit,
        p10=ch.p10,
        p50=ch.p50,
        p90=ch.p90,
        p10_days=ch.p10_days,
        p50_days=ch.p50_days,
        p90_days=ch.p90_days,
        life_due_days=ch.life_due_days,
        due_days=round(ch.due_days, 1),
        failed=ch.failed,
    )


def _rul_label(ch: H.ComponentHealth) -> str:
    if ch.rul_unit == "sorties":
        return f"{ch.p50:.0f} sorties ({ch.p10:.0f}–{ch.p90:.0f})"
    return f"{ch.p50_days:.0f} days ({ch.p10_days:.0f}–{ch.p90_days:.0f})"


@router.get("/aircraft", response_model=list[AircraftRow], dependencies=[Depends(require("fleet"))])
def list_aircraft(base_id: str | None = None, session: Session = Depends(get_session)) -> list[AircraftRow]:
    as_of = H.as_of(session)
    since = as_of - timedelta(days=30)
    defects = dict(
        session.exec(
            select(MaintenanceRecord.tail, func.count())
            .where(MaintenanceRecord.record_type == "defect", MaintenanceRecord.date >= since)
            .group_by(MaintenanceRecord.tail)
        ).all()
    )
    sq = {s.id: s.name for s in session.exec(select(Squadron)).all()}
    rows = []
    for ah in H.fleet(session, base_id=base_id):
        a = ah.aircraft
        rows.append(
            AircraftRow(
                tail=a.tail,
                type=a.type,
                base_id=a.base_id,
                base_name=ah.base.name,
                squadron=sq[a.squadron_id],
                status=ah.status,
                status_reason=ah.status_reason,
                health=ah.health,
                lowest_component=ah.lowest.position,
                lowest_rul_days=ah.lowest.p50_days,
                lowest_rul_label=_rul_label(ah.lowest),
                next_due_component=ah.next_due.position,
                next_due_days=round(ah.next_due.due_days, 1),
                defects_30d=defects.get(a.tail, 0),
                total_hours=a.total_hours,
                total_cycles=a.total_cycles,
                sortie_profile=a.sortie_profile,
            )
        )
    return rows


def _one(session: Session, tail: str, day_offset: int = 0) -> H.AircraftHealth:
    a = session.get(Aircraft, tail)
    if a is None:
        raise HTTPException(404, f"Aircraft {tail} not found")
    from app.models import Base, WorkOrder

    comps = session.exec(select(Component).where(Component.tail == tail).order_by(Component.id)).all()
    wo = session.exec(select(WorkOrder).where(WorkOrder.tail == tail)).first()
    return H.aircraft_health(a, session.get(Base, a.base_id), list(comps), wo, H.as_of(session), day_offset)


@router.get("/aircraft/export.pdf", dependencies=[Depends(require("fleet"))])
def export_fleet_pdf(base_id: str | None = None, session: Session = Depends(get_session)) -> Response:
    from app.services import pdf

    rows = list_aircraft(base_id=base_id, session=session)
    data = [["Tail", "Type", "Base", "Squadron", "Status", "Health", "Lowest RUL", "Next due", "Defects 30d", "Hours"]]
    for r in rows:
        data.append(
            [
                r.tail,
                r.type,
                r.base_name,
                r.squadron,
                r.status.capitalize(),
                f"{r.health:.0f}",
                f"{r.lowest_component}: {r.lowest_rul_label}",
                f"{r.next_due_component} in {max(0, r.next_due_days):.0f} d",
                r.defects_30d,
                f"{r.total_hours:,.0f}",
            ]
        )
    as_of = H.as_of(session)
    body = pdf.build(
        "Fleet status",
        f"As of {as_of:%d %b %Y} · {len(rows)} aircraft{' · base ' + base_id if base_id else ''}",
        [pdf.table(data, status_col=4)],
        landscape_mode=True,
    )
    return Response(
        body,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="aeropulse-fleet.pdf"'},
    )


class RecordOut(BaseModel):
    id: int
    tail: str
    date: str
    record_type: str
    defect_code: str
    component_kind: str
    narrative: str
    action_taken: str
    man_hours: float
    downtime_days: float
    batch: str | None
    technician: str
    parts_used: list[str]


def _record(r: MaintenanceRecord) -> RecordOut:
    return RecordOut(
        id=r.id,
        tail=r.tail,
        date=r.date.isoformat(),
        record_type=r.record_type,
        defect_code=r.defect_code,
        component_kind=r.component_kind,
        narrative=r.narrative,
        action_taken=r.action_taken,
        man_hours=r.man_hours,
        downtime_days=r.downtime_days,
        batch=r.batch,
        technician=r.technician,
        parts_used=list(r.parts_used or []),
    )


class AircraftDetail(BaseModel):
    tail: str
    type: str
    base_id: str
    base_name: str
    environment: str
    squadron: str
    sortie_profile: str
    sorties_per_day: float
    status: str
    status_reason: str
    health: float
    total_hours: float
    total_cycles: int
    entered_service: str
    work_order: dict | None
    components: list[ComponentBrief]
    recent_records: list[RecordOut]
    planned_blocks: list[dict]


@router.get("/aircraft/{tail}", response_model=AircraftDetail, dependencies=[Depends(require("fleet"))])
def get_aircraft(tail: str, session: Session = Depends(get_session)) -> AircraftDetail:
    ah = _one(session, tail)
    a = ah.aircraft
    recs = session.exec(
        select(MaintenanceRecord)
        .where(MaintenanceRecord.tail == tail)
        .order_by(MaintenanceRecord.date.desc())
        .limit(12)  # type: ignore[union-attr]
    ).all()
    wo = ah.work_order
    return AircraftDetail(
        tail=a.tail,
        type=a.type,
        base_id=a.base_id,
        base_name=ah.base.name,
        environment=ah.base.environment,
        squadron=session.get(Squadron, a.squadron_id).name,
        sortie_profile=a.sortie_profile,
        sorties_per_day=a.sorties_per_day,
        status=ah.status,
        status_reason=ah.status_reason,
        health=ah.health,
        total_hours=a.total_hours,
        total_cycles=a.total_cycles,
        entered_service=a.entered_service.isoformat(),
        work_order=None
        if wo is None
        else {
            "title": wo.title,
            "status": wo.status,
            "remaining_days": wo.remaining_days,
            "opened_on": wo.opened_on.isoformat(),
            "part_number": wo.part_number,
        },
        components=[_brief(c) for c in ah.components],
        recent_records=[_record(r) for r in recs],
        planned_blocks=[b for b in active_plan(session) if b["tail"] == tail],
    )


class TwinOut(BaseModel):
    tail: str
    day_offset: int
    date: str
    health: float
    status: str
    components: list[ComponentBrief]


@router.get("/aircraft/{tail}/twin", response_model=TwinOut, dependencies=[Depends(require("fleet"))])
def twin(tail: str, day_offset: int = Query(0, ge=-90, le=60), session: Session = Depends(get_session)) -> TwinOut:
    ah = _one(session, tail, day_offset)
    return TwinOut(
        tail=tail,
        day_offset=day_offset,
        date=(H.as_of(session) + timedelta(days=day_offset)).isoformat(),
        health=ah.health,
        status=ah.status if day_offset else ah.status,
        components=[_brief(c) for c in ah.components],
    )


@router.get("/aircraft/{tail}/twin/series", dependencies=[Depends(require("fleet"))])
def twin_series(tail: str, session: Session = Depends(get_session)) -> dict:
    """Component health for every 5 days from −90 to +60 (lets the slider recolour without round trips)."""
    offsets = list(range(-90, 61, 5))
    out: dict[str, list[float]] = {}
    overall = []
    for d in offsets:
        ah = _one(session, tail, d)
        overall.append(ah.health)
        for c in ah.components:
            out.setdefault(str(c.id), []).append(c.health)
    return {"offsets": offsets, "aircraft": overall, "components": out}


@router.get("/aircraft/{tail}/components/{component_id}", dependencies=[Depends(require("fleet"))])
def component_detail(tail: str, component_id: int, session: Session = Depends(get_session)) -> dict:
    ah = _one(session, tail)
    ch = next((c for c in ah.components if c.id == component_id), None)
    if ch is None:
        raise HTTPException(404, "Component not found on this aircraft")
    comp = session.get(Component, component_id)
    a = ah.aircraft
    reasons, history, anomaly = [], [], None
    if ch.kind == "engine" and comp.cmapss_unit is not None:
        t = R.track(comp.cmapss_dataset, comp.cmapss_unit, comp.telemetry_injection)
        reasons = R.reasons(t, top=5)
        anomaly = score_engine(t, ch.p50)
        tail_pred = t.pred.tail(80)
        history = [
            {
                "day": round((int(r.cycle) - int(t.pred["cycle"].iloc[-1])) / a.sorties_per_day, 1),
                "cycle": int(r.cycle),
                "p10": round(float(r.p10), 1),
                "p50": round(float(r.p50), 1),
                "p90": round(float(r.p90), 1),
            }
            for r in tail_pred.itertuples()
        ]
    else:
        # Condition trajectory: past (from wear rate) and projected.
        for d in range(-90, 61, 5):
            c2 = H.component_health(comp, a, ah.base, H.as_of(session), d)
            history.append({"day": d, "p10": c2.p10_days, "p50": c2.p50_days, "p90": c2.p90_days, "health": c2.health})
    q = select(MaintenanceRecord).where(MaintenanceRecord.tail == tail, MaintenanceRecord.component_kind == ch.kind)
    recs = session.exec(q.order_by(MaintenanceRecord.date.desc()).limit(10)).all()  # type: ignore[union-attr]
    same_batch = []
    if ch.kind != "engine":
        same_batch = session.exec(
            select(MaintenanceRecord)
            .where(MaintenanceRecord.batch == ch.batch, MaintenanceRecord.tail != tail)
            .order_by(MaintenanceRecord.date.desc())
            .limit(10)  # type: ignore[union-attr]
        ).all()
    return {
        **_brief(ch).model_dump(),
        "rul_label": _rul_label(ch),
        "part_number": ch.part_number,
        "serial": ch.serial,
        "batch": ch.batch,
        "supplier": ch.supplier,
        "installed_on": ch.installed_on.isoformat(),
        "life_usage": ch.life_usage,
        "model": ch.model,
        "engine_ref": ch.engine_ref,
        "cycle": ch.cycle,
        "env_multiplier": ch.env_multiplier,
        "profile_multiplier": ch.profile_multiplier,
        "adjustment_note": ch.adjustment_note,
        "environment": ah.base.environment,
        "sortie_profile": a.sortie_profile,
        "sorties_per_day": a.sorties_per_day,
        "reasons": reasons,
        "anomaly": anomaly,
        "history": history,
        "records": [_record(r).model_dump() for r in recs],
        "same_batch_records": [_record(r).model_dump() for r in same_batch],
        "bad_batch": len(same_batch) >= 3,
    }


# ---------------------------------------------------------------- live telemetry (simulated IoT stream)
SIGNALS = [
    {"key": "egt", "label": "EGT", "unit": "°C", "normal": [640, 702]},
    {"key": "n1", "label": "N1", "unit": "%", "normal": [94, 101.5]},
    {"key": "n2", "label": "N2", "unit": "%", "normal": [95, 101.5]},
    {"key": "fuel_flow", "label": "Fuel flow", "unit": "kg/h", "normal": [2280, 2560]},
    {"key": "vibration", "label": "Vibration", "unit": "ips", "normal": [0.2, 1.1]},
    {"key": "oil_pressure", "label": "Oil pressure", "unit": "psi", "normal": [46, 62]},
]


def _frame_values(raw, wear: float, k: float, rng: np.random.Generator) -> dict:
    """Interpolate the engine's recent C-MAPSS history at fractional index k and map to cockpit units."""
    n = len(raw) - 1
    pos = k % (2 * n)
    x = pos if pos <= n else 2 * n - pos  # ping-pong over the recent history, no jump at wrap-around
    i = min(int(math.floor(x)), n - 1)
    f = x - i
    r = {s: float(raw[s].iloc[i] * (1 - f) + raw[s].iloc[i + 1] * f) for s in ("s4", "s8", "s9", "s11", "s12")}
    power = 1 + 0.012 * math.sin(k * 0.9)
    return {
        "egt": round((r["s4"] - 491.67) * 5 / 9 + 180 + rng.normal(0, 0.8), 1),
        "n1": round(r["s8"] / 2388.0 * 100 * power + rng.normal(0, 0.05), 2),
        "n2": round(r["s9"] / 9065.0 * 100 * power + rng.normal(0, 0.05), 2),
        "fuel_flow": round(r["s12"] * r["s11"] * 0.1 * power + rng.normal(0, 6), 0),
        "vibration": round(0.42 + 0.95 * wear + abs(rng.normal(0, 0.04)), 2),
        "oil_pressure": round(56 - 9 * wear + rng.normal(0, 0.4), 1),
    }


@ws_router.websocket("/ws/telemetry/{tail}")
async def telemetry(ws: WebSocket, tail: str, role: str = "engineering_officer"):
    if role not in {r.value for r in ACCESS["fleet"]}:
        await ws.close(code=4403)
        return
    await ws.accept()
    with Session(get_engine()) as session:
        try:
            ah = _one(session, tail)
        except HTTPException:
            await ws.close(code=4404)
            return
        engines = []
        for ch in ah.components:
            if ch.kind != "engine":
                continue
            comp = session.get(Component, ch.id)
            if comp.cmapss_unit is None or not R.models_ready():
                continue
            t = R.track(comp.cmapss_dataset, comp.cmapss_unit, comp.telemetry_injection)
            engines.append((ch.position, t.raw.tail(30).reset_index(drop=True), max(0.0, 1 - min(ch.p50, 125) / 125)))
    rng = np.random.default_rng(abs(hash(tail)) % 2**32)
    await ws.send_json(
        {
            "type": "meta",
            "tail": tail,
            "signals": SIGNALS,
            "engines": [e[0] for e in engines],
            "source": "Simulated stream replaying each engine's recent C-MAPSS sensor history",
        }
    )
    k = 0.0
    try:
        while True:
            frame = {pos: _frame_values(raw, wear, k, rng) for pos, raw, wear in engines}
            await ws.send_json({"type": "frame", "k": round(k, 2), "engines": frame})
            k += 0.12
            await asyncio.sleep(0.5)
    except (WebSocketDisconnect, RuntimeError):
        return
