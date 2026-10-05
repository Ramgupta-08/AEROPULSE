"""Append-only SHA-256 hash chain over maintenance records, schedule changes and approvals."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, date, datetime

from sqlmodel import Session, select

from app.models import LedgerEntry, MaintenanceRecord

GENESIS = "0" * 64


def canonical(obj: dict) -> str:
    def default(o):
        if isinstance(o, date | datetime):
            return o.isoformat()
        raise TypeError(type(o))

    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=default, ensure_ascii=False)


def entry_hash(
    prev_hash: str, ts: datetime, actor: str, action: str, entity_type: str, entity_id: str, payload: dict
) -> str:
    body = canonical(
        {
            "prev": prev_hash,
            "ts": ts.isoformat(),
            "actor": actor,
            "action": action,
            "type": entity_type,
            "id": entity_id,
            "payload": payload,
        }
    )
    return hashlib.sha256(body.encode()).hexdigest()


def record_payload(r: MaintenanceRecord) -> dict:
    """Fields of a technical record that are protected by the chain."""
    return {
        "tail": r.tail,
        "date": r.date.isoformat(),
        "component_kind": r.component_kind,
        "defect_code": r.defect_code,
        "narrative": r.narrative,
        "action_taken": r.action_taken,
        "man_hours": r.man_hours,
        "parts_used": list(r.parts_used or []),
        "batch": r.batch,
        "technician": r.technician,
    }


def last_hash(session: Session) -> str:
    last = session.exec(select(LedgerEntry).order_by(LedgerEntry.seq.desc()).limit(1)).first()  # type: ignore[union-attr]
    return last.hash if last else GENESIS


class Chain:
    """Batch appender (keeps the running hash in memory, e.g. for seeding thousands of records)."""

    def __init__(self, session: Session):
        self.session = session
        self.prev = last_hash(session)

    def append(
        self,
        *,
        actor: str,
        role: str,
        action: str,
        entity_type: str,
        entity_id: str,
        summary: str,
        payload: dict,
        tail: str | None = None,
        ts: datetime | None = None,
    ) -> LedgerEntry:
        ts = ts or datetime.now(UTC).replace(microsecond=0)
        h = entry_hash(self.prev, ts, actor, action, entity_type, entity_id, payload)
        e = LedgerEntry(
            ts=ts,
            actor=actor,
            role=role,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            tail=tail,
            summary=summary,
            payload=payload,
            prev_hash=self.prev,
            hash=h,
        )
        self.session.add(e)
        self.prev = h
        return e


def append(session: Session, **kw) -> LedgerEntry:
    return Chain(session).append(**kw)


def verify(session: Session) -> dict:
    """Recompute every link and compare protected records with their chained payload."""
    prev = GENESIS
    n = 0
    broken: list[dict] = []
    records = {str(r.id): r for r in session.exec(select(MaintenanceRecord)).all()}
    for e in session.exec(select(LedgerEntry).order_by(LedgerEntry.seq)).all():  # type: ignore[arg-type]
        n += 1
        problems = []
        if e.prev_hash != prev:
            problems.append("link to previous entry broken")
        if entry_hash(e.prev_hash, e.ts, e.actor, e.action, e.entity_type, e.entity_id, e.payload) != e.hash:
            problems.append("entry hash mismatch (ledger entry altered)")
        if e.entity_type == "maintenance_record" and e.action == "record.create":
            r = records.get(e.entity_id)
            if r is None:
                problems.append("record deleted")
            elif canonical(record_payload(r)) != canonical(e.payload):
                changed = [k for k, v in record_payload(r).items() if e.payload.get(k) != v]
                problems.append(f"record altered after signing ({', '.join(changed)})")
        if problems:
            broken.append({"seq": e.seq, "entity_id": e.entity_id, "tail": e.tail, "problems": problems})
        prev = e.hash
    return {"total": n, "verified": n - len(broken), "ok": not broken, "broken": broken[:20], "head": prev}
