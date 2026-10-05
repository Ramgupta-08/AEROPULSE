"""Maintenance agency scorecard: turnaround vs promise, on-time %, repeat failures, backlog, routing."""

from __future__ import annotations

from collections import defaultdict
from datetime import date

from sqlmodel import Session, select

from app.models import Agency, AgencyJob
from app.services import domain as D


def scorecard(session: Session, as_of: date) -> dict:
    agencies = session.exec(select(Agency)).all()
    jobs = session.exec(select(AgencyJob)).all()
    by_agency: dict[str, list[AgencyJob]] = defaultdict(list)
    for j in jobs:
        by_agency[j.agency_id].append(j)
    months = [(as_of.year * 12 + as_of.month - 1 - k) for k in range(11, -1, -1)]
    rows = []
    for a in agencies:
        js = by_agency.get(a.id, [])
        done = [j for j in js if j.returned_on]
        tat = [(j.returned_on - j.sent_on).days for j in done]
        on_time = [t <= j.promised_days for t, j in zip(tat, done, strict=True)]
        repeat = [j.repeat_failure for j in done]
        backlog = [j for j in js if not j.returned_on]
        overdue = [j for j in backlog if (as_of - j.sent_on).days > j.promised_days]
        trend = []
        for mi in months:
            m_done = [
                (j.returned_on - j.sent_on).days
                for j in done
                if j.returned_on.year * 12 + j.returned_on.month - 1 == mi
            ]
            trend.append(round(sum(m_done) / len(m_done), 1) if m_done else None)
        avg_tat = sum(tat) / len(tat) if tat else 0
        otp = sum(on_time) / len(on_time) if on_time else 0
        rfr = sum(repeat) / len(repeat) if repeat else 0
        tat_ratio = avg_tat / a.promised_tat_days if a.promised_tat_days else 1
        score = 100 * (0.4 * otp + 0.4 * (1 - min(1, rfr / 0.2)) + 0.2 * max(0, 1 - max(0, tat_ratio - 0.8)))
        rows.append(
            {
                "id": a.id,
                "name": a.name,
                "kind": a.kind,
                "location": a.location,
                "specialities": a.specialities.split(","),
                "promised_tat_days": a.promised_tat_days,
                "avg_tat_days": round(avg_tat, 1),
                "tat_ratio": round(tat_ratio, 2),
                "on_time_pct": round(100 * otp, 1),
                "repeat_failure_pct": round(100 * rfr, 1),
                "jobs_completed": len(done),
                "backlog": len(backlog),
                "overdue": len(overdue),
                "capacity": a.capacity,
                "utilisation_pct": round(100 * len(backlog) / a.capacity, 0),
                "score": round(score, 1),
                "trend": trend,
            }
        )
    rows.sort(key=lambda r: -r["score"])
    for i, r in enumerate(rows, start=1):
        r["rank"] = i
    month_labels = [date(m // 12, m % 12 + 1, 1).strftime("%b %y") for m in months]
    routing = []
    for kind in D.KINDS:
        cands = [r for r in rows if kind in r["specialities"]]
        if not cands:
            continue
        # Prefer score, penalise agencies running at or beyond capacity.
        best = max(cands, key=lambda r: r["score"] - (15 if r["utilisation_pct"] >= 100 else 0))
        worst = min(cands, key=lambda r: r["score"])
        routing.append(
            {
                "component_kind": kind,
                "label": D.KIND_LABEL[kind],
                "recommended": best["id"],
                "recommended_name": best["name"],
                "reason": f"{best['on_time_pct']:.0f}% on time, {best['repeat_failure_pct']:.0f}% repeat failures, {best['avg_tat_days']:.0f} d average turnaround"
                + (
                    f"; avoid {worst['name']} ({worst['repeat_failure_pct']:.0f}% repeat failures)"
                    if worst is not best and worst["repeat_failure_pct"] > best["repeat_failure_pct"] + 5
                    else ""
                ),
                "alternatives": [c["id"] for c in cands if c is not best],
            }
        )
    return {"agencies": rows, "months": month_labels, "routing": routing}
