from __future__ import annotations

import csv
import io
import json
from collections import Counter
from datetime import UTC, date, datetime, time

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse
from sqlmodel import Session, func, select

from app.core.auth import DEMO_USERS, Role, require
from app.core.db import get_session
from app.models import AgencyJob, Aircraft, Component, MaintenanceRecord, Part, StockLevel
from app.services import domain as D
from app.services import health as H
from app.services.hashchain import Chain, record_payload

router = APIRouter(prefix="/api/datahub", tags=["data hub"])

TARGET_FIELDS = {
    "tail": "Aircraft tail number (e.g. AP-112)",
    "date": "Date of the entry (YYYY-MM-DD or DD/MM/YYYY)",
    "component_kind": "System: engine, apu, landing_gear, hydraulics, avionics, fuel, flight_controls, ecs",
    "defect_code": "Defect code (e.g. HYD-LKS)",
    "narrative": "Technician's description",
    "action_taken": "Rectification action",
    "man_hours": "Man-hours (number)",
}
SYNONYMS = {
    "tail": ["tail", "tail_no", "tail number", "aircraft", "reg", "registration"],
    "date": ["date", "entry_date", "dt", "reported"],
    "component_kind": ["component", "system", "ata", "kind", "component_kind"],
    "defect_code": ["defect", "code", "defect_code", "snag code"],
    "narrative": ["narrative", "description", "snag", "defect description", "remarks"],
    "action_taken": ["action", "rectification", "action taken", "action_taken", "work done"],
    "man_hours": ["man_hours", "manhours", "mh", "hours", "labour"],
}


def _quality(missing: int, dup: int, oor: int, n: int) -> dict:
    n = max(1, n)
    m, d, o = 100 * missing / n, 100 * dup / n, 100 * oor / n
    return {
        "missing_pct": round(m, 2),
        "duplicate_pct": round(d, 2),
        "out_of_range_pct": round(o, 2),
        "score": round(max(0.0, 100 - (m + 2 * d + 1.5 * o)), 1),
    }


@router.get("/sources", dependencies=[Depends(require("datahub"))])
def sources(session: Session = Depends(get_session)) -> dict:
    as_of = H.as_of(session)
    sync = lambda h, m: datetime.combine(as_of, time(h, m), tzinfo=UTC).isoformat()  # noqa: E731
    comps = session.exec(select(Component)).all()
    engines = [c for c in comps if c.kind == "engine"]
    telemetry_rows = sum(c.cmapss_cycle or 0 for c in engines)
    recs = session.exec(select(MaintenanceRecord)).all()
    rec_missing = sum(
        1 for r in recs if r.record_type == "defect" and (r.component_id is None or not r.action_taken.strip())
    )
    rec_dup = sum(n - 1 for n in Counter((r.tail, r.date, r.defect_code, r.narrative) for r in recs).values() if n > 1)
    rec_oor = sum(1 for r in recs if r.man_hours > 200 or r.man_hours < 0 or r.downtime_days > 60)
    stock = session.exec(select(StockLevel)).all()
    parts = session.exec(select(Part)).all()
    sp_missing = sum(1 for p in parts if not p.supplier)
    sp_dup = sum(n - 1 for n in Counter((s.part_number, s.base_id) for s in stock).values() if n > 1)
    sp_oor = sum(1 for s in stock if s.on_hand < 0 or s.on_hand > 50)
    jobs = session.exec(select(AgencyJob)).all()
    ag_missing = sum(1 for j in jobs if j.returned_on is None and (as_of - j.sent_on).days > 2 * j.promised_days)
    ag_oor = sum(1 for j in jobs if j.returned_on and (j.returned_on - j.sent_on).days > 3 * j.promised_days)
    defects = [r for r in recs if r.record_type == "defect"]
    linked = sum(1 for r in defects if r.component_id is not None)
    serials = {c.serial for c in comps}
    return {
        "as_of": as_of.isoformat(),
        "sources": [
            {
                "id": "hms",
                "name": "Health Monitoring",
                "system": "Aircraft HUMS / engine monitoring (simulated, NASA C-MAPSS trajectories)",
                "records": telemetry_rows,
                "entities": f"{len(engines)} engines · 6 live signals",
                "last_sync": sync(6, 0),
                "mode": "stream (WebSocket)",
                "keys": ["tail", "engine position", "serial"],
                **_quality(0, 0, 0, telemetry_rows),
            },
            {
                "id": "records",
                "name": "Technical Records",
                "system": "Maintenance logbook / work orders",
                "records": len(recs),
                "entities": f"{len({r.tail for r in recs})} aircraft",
                "last_sync": sync(7, 15),
                "mode": "batch + live entry",
                "keys": ["tail", "component", "batch", "defect code"],
                **_quality(rec_missing, rec_dup, rec_oor, len(recs)),
            },
            {
                "id": "spares",
                "name": "Spares",
                "system": "Inventory & supply chain",
                "records": len(stock),
                "entities": f"{len(parts)} part numbers · 8 bases",
                "last_sync": sync(6, 45),
                "mode": "batch (hourly)",
                "keys": ["part number", "base"],
                **_quality(sp_missing, sp_dup, sp_oor, len(stock)),
            },
            {
                "id": "agencies",
                "name": "Maintenance Agencies",
                "system": "Repair depots & OEM service centres",
                "records": len(jobs),
                "entities": "6 agencies",
                "last_sync": sync(5, 30),
                "mode": "batch (daily)",
                "keys": ["part number", "serial", "tail"],
                **_quality(ag_missing, 0, ag_oor, len(jobs)),
            },
        ],
        "lineage": {
            "join_path": ["Aircraft (tail)", "Component (kind · position)", "Part (part number · serial · batch)"],
            "links": [
                {
                    "from": "Health Monitoring",
                    "to": "Component",
                    "on": "tail + engine position → serial",
                    "coverage_pct": 100.0,
                },
                {
                    "from": "Technical Records",
                    "to": "Component",
                    "on": "tail + component kind → component",
                    "coverage_pct": round(100 * linked / max(1, len(recs)), 1),
                },
                {"from": "Spares", "to": "Part", "on": "part number", "coverage_pct": 100.0},
                {"from": "Agencies", "to": "Part", "on": "part number + tail", "coverage_pct": 100.0},
            ],
            "components": len(comps),
            "serials": len(serials),
            "aircraft": session.exec(select(func.count()).select_from(Aircraft)).one(),
        },
        "api_docs": "/docs",
    }


@router.get("/template", response_class=PlainTextResponse, dependencies=[Depends(require("datahub"))])
def template() -> str:
    return (
        "Tail No,Entry Date,System,Snag Code,Description,Action Taken,MH\n"
        "AP-121,05/10/2026,hydraulics,HYD-LKS,Seepage at L/H actuator seal after sortie,Seal kit replaced; leak check OK,6.5\n"
        "AP-108,04/10/2026,avionics,AV-INT,MFD R/H blanking intermittently,Connector reseated and cleaned; BITE OK,2\n"
        "AP-199,04/10/2026,engine,ENG-EGT,EGT spread high,Thermocouple harness checked,4\n"
    )


def _suggest(columns: list[str]) -> dict[str, str | None]:
    out = {}
    for field, syns in SYNONYMS.items():
        best = next((c for c in columns if c.strip().lower() in syns), None)
        best = best or next((c for c in columns if any(s in c.strip().lower() for s in syns)), None)
        out[field] = best
    return out


def _parse_date(s: str) -> date:
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d %b %Y"):
        try:
            return datetime.strptime(s.strip(), fmt).date()
        except ValueError:
            continue
    raise ValueError(f"unrecognised date '{s}'")


KIND_ALIASES = {
    **{k: k for k in D.KINDS},
    **{v.lower(): k for k, v in D.KIND_LABEL.items()},
    "landing gear": "landing_gear",
    "flight controls": "flight_controls",
    "hyd": "hydraulics",
    "eng": "engine",
}


@router.post("/upload")
async def upload(
    file: UploadFile = File(...),
    mapping: str | None = Form(None),
    dry_run: bool = Form(True),
    role: Role = Depends(require("datahub")),
    session: Session = Depends(get_session),
) -> dict:
    raw = (await file.read()).decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(raw))
    columns = reader.fieldnames or []
    if not columns:
        raise HTTPException(422, "The file has no header row.")
    rows = list(reader)
    if len(rows) > 5000:
        raise HTTPException(413, "Up to 5,000 rows per upload.")
    m = json.loads(mapping) if mapping else _suggest(columns)
    tails = {a.tail: a for a in session.exec(select(Aircraft)).all()}
    preview, valid = [], []
    for i, row in enumerate(rows, start=2):
        errs = []
        rec = {}
        for field in TARGET_FIELDS:
            col = m.get(field)
            rec[field] = (row.get(col) or "").strip() if col else ""
            if not rec[field]:
                errs.append(f"{field} missing")
        if rec["tail"] and rec["tail"].upper() not in tails:
            errs.append(f"unknown tail {rec['tail']}")
        try:
            rec["date"] = _parse_date(rec["date"]).isoformat() if rec["date"] else ""
        except ValueError as exc:
            errs.append(str(exc))
        kind = KIND_ALIASES.get(rec["component_kind"].lower())
        if rec["component_kind"] and not kind:
            errs.append(f"unknown system '{rec['component_kind']}'")
        rec["component_kind"] = kind or rec["component_kind"]
        try:
            mh = float(rec["man_hours"]) if rec["man_hours"] else None
            if mh is not None and not 0 <= mh <= 500:
                errs.append("man-hours out of range (0–500)")
            rec["man_hours"] = mh
        except ValueError:
            errs.append(f"man-hours not a number '{rec['man_hours']}'")
        if not errs:
            valid.append(rec)
        if len(preview) < 25:
            preview.append({"line": i, "record": rec, "errors": errs})
    imported = 0
    if not dry_run and valid:
        chain = Chain(session)
        for rec in valid:
            a = tails[rec["tail"].upper()]
            comp = session.exec(
                select(Component).where(Component.tail == a.tail, Component.kind == rec["component_kind"])
            ).first()
            r = MaintenanceRecord(
                tail=a.tail,
                base_id=a.base_id,
                component_id=comp.id if comp else None,
                component_kind=rec["component_kind"],
                date=date.fromisoformat(rec["date"]),
                record_type="defect",
                defect_code=rec["defect_code"].upper(),
                narrative=rec["narrative"],
                action_taken=rec["action_taken"],
                man_hours=rec["man_hours"],
                parts_used=[],
                technician=f"Import · {DEMO_USERS[role]}",
            )
            session.add(r)
            session.flush()
            chain.append(
                actor=DEMO_USERS[role],
                role=role.value,
                action="record.create",
                entity_type="maintenance_record",
                entity_id=str(r.id),
                tail=r.tail,
                summary=f"Imported {r.defect_code} · {r.narrative[:70]}",
                payload=record_payload(r),
            )
            imported += 1
        session.commit()
    return {
        "filename": file.filename,
        "columns": columns,
        "mapping": m,
        "target_fields": TARGET_FIELDS,
        "rows": len(rows),
        "valid": len(valid),
        "invalid": len(rows) - len(valid),
        "preview": preview,
        "dry_run": dry_run,
        "imported": imported,
    }
