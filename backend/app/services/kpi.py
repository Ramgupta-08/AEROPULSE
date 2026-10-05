"""Fleet KPIs: readiness history from technical records, MTBF/MTTR, AOG hours, alerts."""

from __future__ import annotations

import math
from datetime import date, timedelta

from sqlmodel import Session, select

from app.models import Aircraft, MaintenanceRecord
from app.services import health as H
from app.services import planning as P


def downtime_history(session: Session, days: int = 91, base_id: str | None = None) -> list[dict]:
    """Daily mission-capable count for the last `days` days (ending yesterday) from record downtime."""
    as_of = H.as_of(session)
    start = as_of - timedelta(days=days)
    aircraft = session.exec(select(Aircraft)).all()
    tails = {a.tail for a in aircraft if not base_id or a.base_id == base_id}
    q = select(MaintenanceRecord).where(
        MaintenanceRecord.downtime_days > 0, MaintenanceRecord.date >= start - timedelta(days=60)
    )
    down = [[False] * days for _ in range(len(tails))]
    idx = {t: i for i, t in enumerate(sorted(tails))}
    aog = [0.0] * days
    for r in session.exec(q).all():
        if r.tail not in idx:
            continue
        s = (r.date - start).days
        e = s + math.ceil(r.downtime_days)
        for d in range(max(0, s), min(days, e)):
            down[idx[r.tail]][d] = True
            if r.aog:
                aog[d] += 24
    out = []
    for d in range(days):
        n_down = sum(1 for row in down if row[d])
        out.append(
            {
                "date": (start + timedelta(days=d)).isoformat(),
                "mc": len(tails) - n_down,
                "total": len(tails),
                "aog_hours": aog[d],
            }
        )
    return out


def _reliability(session: Session, start: date, end: date, base_id: str | None = None) -> tuple[float, float]:
    q = select(MaintenanceRecord).where(
        MaintenanceRecord.date >= start, MaintenanceRecord.date < end, MaintenanceRecord.record_type == "defect"
    )
    recs = [r for r in session.exec(q).all() if not base_id or r.base_id == base_id]
    aircraft = [a for a in session.exec(select(Aircraft)).all() if not base_id or a.base_id == base_id]
    from app.services.domain import TYPES

    days = (end - start).days
    flight_hours = sum(a.sorties_per_day * TYPES[a.type]["hours_per_sortie"] * days for a in aircraft)
    mtbf = flight_hours / max(1, len(recs))
    repairs = [r.downtime_days * 24 for r in recs if not r.aog and r.downtime_days > 0]
    mttr = sum(repairs) / max(1, len(repairs))
    return round(mtbf, 1), round(mttr, 1)


def overview(session: Session, base_id: str | None = None) -> dict:
    as_of = H.as_of(session)
    fleet = H.fleet(session, base_id=base_id)
    total = len(fleet)
    by = {s: sum(1 for a in fleet if a.status == s) for s in ("ready", "caution", "grounded")}
    mc = by["ready"] + by["caution"]
    hist = downtime_history(session, 91, base_id)
    weekly = []
    for w in range(13):
        chunk = hist[w * 7 : (w + 1) * 7]
        if chunk:
            weekly.append(round(100 * sum(x["mc"] for x in chunk) / sum(x["total"] for x in chunk), 1))
    last_week = weekly[-1] if weekly else None
    readiness = round(100 * mc / total, 1) if total else 0.0

    def predicted_within(fl: list[H.AircraftHealth], days: int) -> int:
        return sum(
            1
            for a in fl
            for c in a.components
            if c.p50_days <= days and (a.work_order is None or a.work_order.component_id != c.id)
        )

    pred14 = predicted_within(fleet, 14)
    fleet_prev = H.fleet(session, day_offset=-7, base_id=base_id)
    pred14_prev = sum(1 for a in fleet_prev for c in a.components if c.p50_days <= 14)
    aog_week = sum(x["aog_hours"] for x in hist[-7:])
    aog_prev = sum(x["aog_hours"] for x in hist[-14:-7])
    aog_weekly = [sum(x["aog_hours"] for x in hist[w * 7 : (w + 1) * 7]) for w in range(13)]
    # AOG this week also includes aircraft on the ground right now awaiting parts.
    aog_now = sum(
        24 * min(7, (as_of - a.work_order.opened_on).days)
        for a in fleet
        if a.work_order and a.work_order.status == "awaiting-part"
    )
    mtbf, mttr = _reliability(session, as_of - timedelta(days=90), as_of, base_id)
    mtbf_prev, mttr_prev = _reliability(session, as_of - timedelta(days=180), as_of - timedelta(days=90), base_id)
    return {
        "as_of": as_of.isoformat(),
        "total": total,
        "readiness_pct": readiness,
        "readiness_delta": round(readiness - last_week, 1) if last_week is not None else None,
        "readiness_spark": [*weekly, readiness],
        "ready": by["ready"],
        "caution": by["caution"],
        "grounded": by["grounded"],
        "mission_capable": mc,
        "predicted_failures_14d": pred14,
        "predicted_failures_delta": pred14 - pred14_prev,
        "aog_hours_week": round(max(aog_week, aog_now), 0),
        "aog_hours_delta": round(max(aog_week, aog_now) - aog_prev, 0),
        "aog_spark": [*aog_weekly[:-1], max(aog_week, aog_now)],
        "mtbf_hours": mtbf,
        "mtbf_delta": round(mtbf - mtbf_prev, 1),
        "mttr_hours": mttr,
        "mttr_delta": round(mttr - mttr_prev, 1),
        "history": hist,
    }


SEVERITY = {
    "engine": 1.0,
    "flight_controls": 0.8,
    "hydraulics": 0.7,
    "landing_gear": 0.6,
    "apu": 0.5,
    "fuel": 0.5,
    "avionics": 0.4,
    "ecs": 0.3,
}


def _headline(t: P.Task, ch: H.ComponentHealth | None) -> str:
    if t.source == "predicted" and ch is not None:
        if ch.rul_unit == "sorties":
            return f"{t.position} fails in {ch.p50:.0f} sorties ({ch.p10:.0f}–{ch.p90:.0f})"
        return f"{t.position} predicted failure in {ch.p50_days:.0f} days ({ch.p10_days:.0f}–{ch.p90_days:.0f})"
    return f"{t.title} due in {max(0, t.due_day)} days"


def alerts(session: Session, state: P.PlanState | None = None, limit: int = 12) -> list[dict]:
    """Priority alerts, one per aircraft, ranked by Σ(failure risk) × (1 + mission impact).

    risk   = component severity × urgency (1 / (1 + days-to-due / 7))
    impact = max over missions this aircraft could support before its predicted failure of
             priority weight × tightness (required ÷ mission-capable aircraft of that type in scope today).
    """
    state = state or P.load_state(session)
    planned = {x["id"]: b for b in P.active_plan(session) for x in b["tasks"]}
    mc_now: dict[tuple[str, str | None], int] = {}
    for ah in state.fleet:
        if ah.status != "grounded":
            for key in ((ah.aircraft.type, ah.aircraft.base_id), (ah.aircraft.type, None)):
                mc_now[key] = mc_now.get(key, 0) + 1
    by_tail: dict[str, list[P.Task]] = {}
    for t in state.tasks:
        if t.source != "work-order" and t.due_day <= 30:
            by_tail.setdefault(t.tail, []).append(t)
    out = []
    for tail, tasks in by_tail.items():
        ah = state.aircraft_index[tail]
        a = ah.aircraft
        score = 0.0
        missions: dict[str, float] = {}
        for t in tasks:
            window_end = t.p90_day if t.p90_day is not None else t.due_day + 7
            impact = 0.0
            for m in state.missions:
                s = (m.start_date - state.as_of).days
                if s > window_end or (m.end_date - state.as_of).days < 0 or m.aircraft_type != a.type:
                    continue
                if m.scope != "fleet" and m.base_id != a.base_id:
                    continue
                avail = mc_now.get((m.aircraft_type, None if m.scope == "fleet" else m.base_id), 0)
                w = {1: 3, 2: 2, 3: 1}[m.priority] * m.required_count / max(1, avail)
                impact = max(impact, w)
                missions[m.name] = max(missions.get(m.name, 0), w)
            score += SEVERITY.get(t.kind, 0.4) / (1 + max(0, t.due_day) / 7) * (1 + impact)
        lead = min(tasks, key=lambda t: t.due_day / SEVERITY.get(t.kind, 0.4))
        ch = next((c for c in ah.components if c.id == lead.component_id), None)
        out.append(
            {
                "tail": tail,
                "base_id": a.base_id,
                "aircraft_type": a.type,
                "task_id": lead.id,
                "component_id": lead.component_id,
                "position": lead.position,
                "kind": lead.kind,
                "source": lead.source,
                "headline": _headline(lead, ch),
                "due_day": min(t.due_day for t in tasks),
                "score": round(100 * score, 1),
                "also_due": [
                    {"task_id": t.id, "title": t.title, "position": t.position, "due_day": t.due_day}
                    for t in tasks
                    if t is not lead
                ],
                "missions": [n for n, _ in sorted(missions.items(), key=lambda kv: -kv[1])][:3],
                "severity": "grounded" if min(t.due_day for t in tasks) <= 7 else "caution",
                "part_source": lead.part_source,
                "planned": all(t.id in planned for t in tasks),
                "planned_start_day": min((planned[t.id]["start_day"] for t in tasks if t.id in planned), default=None),
            }
        )
    out.sort(key=lambda a: -a["score"])
    return out[:limit]
