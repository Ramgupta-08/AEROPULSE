from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.core.auth import DEMO_USERS, Role, require
from app.core.db import get_session
from app.models import Agency, AgencyJob, Aircraft, Component, MaintenanceRecord, Part
from app.services import copilot as C
from app.services import domain as D
from app.services import health as H
from app.services import logbook_nlp as L
from app.services.hashchain import append, record_payload

router = APIRouter(prefix="/api", tags=["technician copilot"])


class AskIn(BaseModel):
    question: str = Field(min_length=3, max_length=1000)


@router.post("/copilot/ask", dependencies=[Depends(require("copilot"))])
def ask(body: AskIn, session: Session = Depends(get_session)) -> dict:
    return C.answer(session, body.question)


@router.get("/logbook/insights", dependencies=[Depends(require("copilot"))])
def logbook_insights(session: Session = Depends(get_session)) -> dict:
    t = L.themes(session)
    return {"insights": L.insights(session), **t}


class ParseIn(BaseModel):
    text: str = Field(min_length=3, max_length=2000)
    tail: str | None = None


@router.post("/logbook/parse", dependencies=[Depends(require("copilot"))])
def parse(body: ParseIn, session: Session = Depends(get_session)) -> dict:
    """Structure a spoken or typed technician note (English / Hindi / Hinglish) into a draft record."""
    return L.structure(session, body.text, body.tail)


class EntryIn(BaseModel):
    tail: str
    component_kind: str
    defect_code: str = Field(min_length=2, max_length=16)
    narrative: str = Field(min_length=5, max_length=2000)
    action_taken: str = Field(min_length=3, max_length=2000)
    man_hours: float = Field(ge=0, le=500)
    downtime_days: float = Field(default=0, ge=0, le=120)
    parts_used: list[str] = []


@router.post("/logbook/entry")
def create_entry(
    body: EntryIn, role: Role = Depends(require("copilot")), session: Session = Depends(get_session)
) -> dict:
    a = session.get(Aircraft, body.tail)
    if a is None:
        raise HTTPException(404, f"Aircraft {body.tail} not found")
    if body.component_kind not in D.KINDS:
        raise HTTPException(422, "Unknown component kind")
    comp = session.exec(
        select(Component).where(Component.tail == a.tail, Component.kind == body.component_kind)
    ).first()
    r = MaintenanceRecord(
        tail=a.tail,
        base_id=a.base_id,
        component_id=comp.id if comp else None,
        component_kind=body.component_kind,
        date=H.as_of(session),
        record_type="defect",
        defect_code=body.defect_code.upper(),
        narrative=body.narrative,
        action_taken=body.action_taken,
        man_hours=body.man_hours,
        downtime_days=body.downtime_days,
        parts_used=body.parts_used,
        batch=comp.batch if comp and body.component_kind == "hydraulics" else None,
        technician=DEMO_USERS[role],
    )
    session.add(r)
    session.flush()
    e = append(
        session,
        actor=r.technician,
        role=role.value,
        action="record.create",
        entity_type="maintenance_record",
        entity_id=str(r.id),
        tail=r.tail,
        summary=f"{r.defect_code} · {r.narrative[:80]}",
        payload=record_payload(r),
    )
    session.commit()
    return {"id": r.id, "ledger_seq": e.seq, "hash": e.hash}


# ---------------------------------------------------------------- part lookup (QR)
@router.get("/parts/{serial}", dependencies=[Depends(require("copilot"))])
def part_history(serial: str, session: Session = Depends(get_session)) -> dict:
    c = session.exec(select(Component).where(Component.serial == serial)).first()
    if c is None:
        raise HTTPException(404, f"No part with serial {serial}")
    a = session.get(Aircraft, c.tail)
    from app.models import Base

    ch = H.component_health(c, a, session.get(Base, a.base_id), H.as_of(session))
    p = session.get(Part, c.part_number)
    recs = session.exec(
        select(MaintenanceRecord)
        .where(MaintenanceRecord.tail == c.tail, MaintenanceRecord.component_kind == c.kind)
        .order_by(MaintenanceRecord.date.desc())
        .limit(10)  # type: ignore[union-attr]
    ).all()
    jobs = session.exec(select(AgencyJob).where(AgencyJob.tail == c.tail, AgencyJob.component_kind == c.kind)).all()
    agencies = {ag.id: ag.name for ag in session.exec(select(Agency)).all()}
    return {
        "serial": c.serial,
        "part_number": c.part_number,
        "name": p.name if p else c.position,
        "batch": c.batch,
        "supplier": c.supplier,
        "installed_on": c.installed_on.isoformat(),
        "tail": c.tail,
        "aircraft_type": a.type,
        "base_id": a.base_id,
        "position": c.position,
        "health": ch.health,
        "rul": f"{ch.p50:.0f} {ch.rul_unit} ({ch.p10:.0f}–{ch.p90:.0f})",
        "life_usage": ch.life_usage,
        "robbed": c.robbed,
        "records": [
            {
                "id": r.id,
                "date": r.date.isoformat(),
                "defect_code": r.defect_code,
                "narrative": r.narrative,
                "action_taken": r.action_taken,
                "technician": r.technician,
            }
            for r in recs
        ],
        "repairs": [
            {
                "agency": agencies.get(j.agency_id, j.agency_id),
                "sent_on": j.sent_on.isoformat(),
                "returned_on": j.returned_on.isoformat() if j.returned_on else None,
                "repeat_failure": j.repeat_failure,
            }
            for j in jobs
        ],
    }


@router.get("/parts", dependencies=[Depends(require("copilot"))])
def parts_for_qr(
    tail: str | None = None, base_id: str | None = None, session: Session = Depends(get_session)
) -> list[dict]:
    q = select(Component).order_by(Component.tail, Component.id)
    if tail:
        q = q.where(Component.tail == tail)
    rows = session.exec(q).all()
    if base_id:
        tails = {a.tail for a in session.exec(select(Aircraft).where(Aircraft.base_id == base_id)).all()}
        rows = [c for c in rows if c.tail in tails]
    return [
        {"serial": c.serial, "part_number": c.part_number, "tail": c.tail, "position": c.position, "batch": c.batch}
        for c in rows[:200]
    ]
