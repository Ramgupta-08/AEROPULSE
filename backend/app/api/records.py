from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, func, select

from app.core.auth import DEMO_USERS, Role, require
from app.core.db import get_session
from app.models import LedgerEntry, MaintenanceRecord, Meta
from app.services.hashchain import verify

router = APIRouter(prefix="/api", tags=["records & audit"])
TAMPER_KEY = "tamper_demo"


@router.get("/records/verify", dependencies=[Depends(require("records"))])
def verify_chain(session: Session = Depends(get_session)) -> dict:
    res = verify(session)
    t = session.get(Meta, TAMPER_KEY)
    res["tamper_demo_active"] = t is not None
    return res


@router.post("/records/tamper")
def tamper(role: Role = Depends(require("records")), session: Session = Depends(get_session)) -> dict:
    """Demo: silently edit one signed technical record directly in the database (as an insider might)."""
    if session.get(Meta, TAMPER_KEY):
        raise HTTPException(409, "A tamper demo is already active — restore it first.")
    r = (
        session.exec(
            select(MaintenanceRecord)
            .where(MaintenanceRecord.tail == "AP-112", MaintenanceRecord.record_type == "defect")
            .order_by(MaintenanceRecord.date.desc())  # type: ignore[union-attr]
        ).first()
        or session.exec(select(MaintenanceRecord)).first()
    )
    original = {"narrative": r.narrative, "man_hours": r.man_hours, "action_taken": r.action_taken}
    session.add(Meta(key=TAMPER_KEY, value=json.dumps({"id": r.id, "original": original, "by": DEMO_USERS[role]})))
    r.action_taken = "No defect found. Aircraft serviceable."
    r.man_hours = round(r.man_hours * 0.3, 1)
    session.add(r)
    session.commit()
    return {"record_id": r.id, "tail": r.tail, "changed": ["action_taken", "man_hours"]}


@router.post("/records/restore")
def restore(role: Role = Depends(require("records")), session: Session = Depends(get_session)) -> dict:
    t = session.get(Meta, TAMPER_KEY)
    if t is None:
        raise HTTPException(404, "No tamper demo active")
    d = json.loads(t.value)
    r = session.get(MaintenanceRecord, d["id"])
    for k, v in d["original"].items():
        setattr(r, k, v)
    session.add(r)
    session.delete(t)
    session.commit()
    return {"record_id": r.id, "restored": True}


@router.get("/audit", dependencies=[Depends(require("records"))])
def audit(
    actor: str | None = None,
    role: str | None = None,
    action: str | None = None,
    tail: str | None = None,
    q: str | None = None,
    limit: int = 100,
    offset: int = 0,
    session: Session = Depends(get_session),
) -> dict:
    stmt = select(LedgerEntry)
    if actor:
        stmt = stmt.where(LedgerEntry.actor == actor)
    if role:
        stmt = stmt.where(LedgerEntry.role == role)
    if action:
        stmt = stmt.where(LedgerEntry.action == action)
    if tail:
        stmt = stmt.where(LedgerEntry.tail == tail)
    if q:
        stmt = stmt.where(LedgerEntry.summary.contains(q))  # type: ignore[union-attr]
    total = session.exec(select(func.count()).select_from(stmt.subquery())).one()
    rows = session.exec(stmt.order_by(LedgerEntry.seq.desc()).offset(offset).limit(min(limit, 500))).all()  # type: ignore[union-attr]
    facets = {
        "actions": sorted(set(session.exec(select(LedgerEntry.action).distinct()).all())),
        "roles": sorted(set(session.exec(select(LedgerEntry.role).distinct()).all())),
        "actors": sorted(set(session.exec(select(LedgerEntry.actor).distinct()).all())),
    }
    return {
        "total": total,
        "items": [
            {
                "seq": e.seq,
                "ts": e.ts.isoformat(),
                "actor": e.actor,
                "role": e.role,
                "action": e.action,
                "entity_type": e.entity_type,
                "entity_id": e.entity_id,
                "tail": e.tail,
                "summary": e.summary,
                "hash": e.hash,
                "prev_hash": e.prev_hash,
            }
            for e in rows
        ],
        "facets": facets,
    }
