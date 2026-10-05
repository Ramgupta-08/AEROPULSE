from __future__ import annotations

import csv
import io
import json
from collections import defaultdict
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from reportlab.platypus import Paragraph, Spacer
from sqlmodel import Session, select

from app.core.auth import require
from app.core.config import ARTIFACTS_DIR
from app.core.db import get_session
from app.models import MaintenanceRecord, Part, PredictionFeedback
from app.services import health as H
from app.services import kpi as K
from app.services import pdf
from app.services import planning as P

router = APIRouter(prefix="/api/reports", tags=["reports"])
LABOUR_LAKH_PER_HOUR = 0.025  # ₹2,500 per man-hour (simulated)


def _plan_compare(session: Session, state: P.PlanState) -> dict:
    from app.api.schedule import compare
    from app.services.scheduler import optimise

    cmp = compare(session, state)
    if cmp["aeropulse"] is None:  # no saved plan: evaluate an optimised plan in memory, without persisting it
        res = optimise(state, mission_aware=True)
        blocks = [{**b, "id": i} for i, b in enumerate(res["blocks"])]
        ap = P.summarise(state, P.plan_downtime(state, blocks))
        cmp["aeropulse"] = ap
        cmp["delta"] = {
            "avg_readiness_pts": round(ap["avg_readiness_pct"] - cmp["reactive"]["avg_readiness_pct"], 1),
            "downtime_avoided_aircraft_days": cmp["reactive"]["downtime_aircraft_days"] - ap["downtime_aircraft_days"],
            "missions_recovered": cmp["reactive"]["missions_short"] - ap["missions_short"],
        }
        cmp["plan_saved"] = False
    else:
        cmp["plan_saved"] = True
    return cmp


def kpis(session: Session) -> dict:
    as_of = H.as_of(session)
    ov = K.overview(session)
    hist = ov.pop("history")
    weekly_avail = [
        round(
            100
            * sum(x["mc"] for x in hist[w * 7 : (w + 1) * 7])
            / max(1, sum(x["total"] for x in hist[w * 7 : (w + 1) * 7])),
            1,
        )
        for w in range(13)
    ]
    weeks = [(as_of - timedelta(days=91 - w * 7)).isoformat() for w in range(13)]
    prices = {p.part_number: p.unit_cost for p in session.exec(select(Part)).all()}
    since = as_of - timedelta(days=365)
    monthly: dict[str, dict] = defaultdict(lambda: {"parts": 0.0, "labour": 0.0})
    for r in session.exec(select(MaintenanceRecord).where(MaintenanceRecord.date >= since)).all():
        key = r.date.strftime("%Y-%m")
        monthly[key]["parts"] += sum(prices.get(pn, 0) for pn in (r.parts_used or []))
        monthly[key]["labour"] += r.man_hours * LABOUR_LAKH_PER_HOUR
    months = sorted(monthly)[-12:]
    cost_90 = sum(
        v["parts"] + v["labour"] for k, v in monthly.items() if k >= (as_of - timedelta(days=90)).strftime("%Y-%m")
    )
    state = P.load_state(session)
    cmp = _plan_compare(session, state)
    metrics = (
        json.loads((ARTIFACTS_DIR / "metrics.json").read_text()) if (ARTIFACTS_DIR / "metrics.json").exists() else None
    )
    fd1 = next((d for d in metrics["datasets"] if d["dataset"] == "FD001"), None) if metrics else None
    fb = session.exec(select(PredictionFeedback)).all()
    return {
        "as_of": as_of.isoformat(),
        "availability_pct": ov["readiness_pct"],
        "availability_weekly": weekly_avail,
        "weeks": weeks,
        "mtbf_hours": ov["mtbf_hours"],
        "mttr_hours": ov["mttr_hours"],
        "aog_hours_week": ov["aog_hours_week"],
        "aog_weekly": ov["aog_spark"],
        "maintenance_cost_90d_lakh": round(cost_90, 1),
        "cost_monthly": [
            {"month": m, "parts": round(monthly[m]["parts"], 1), "labour": round(monthly[m]["labour"], 1)}
            for m in months
        ],
        "downtime_avoided_aircraft_days": cmp["delta"]["downtime_avoided_aircraft_days"],
        "readiness_gain_pts": cmp["delta"]["avg_readiness_pts"],
        "missions_recovered": cmp["delta"]["missions_recovered"],
        "plan_saved": cmp["plan_saved"],
        "prediction": {
            "rmse": fd1["test"]["rmse"] if fd1 else None,
            "coverage_pct": round(100 * fd1["test"]["interval_coverage"], 1) if fd1 else None,
            "nasa_score": fd1["test"]["nasa_score"] if fd1 else None,
            "field_feedback": len(fb),
            "field_accuracy_pct": round(100 * sum(f.verdict == "correct" for f in fb) / len(fb), 1) if fb else None,
        },
        "overview": ov,
    }


@router.get("/kpis", dependencies=[Depends(require("reports"))])
def get_kpis(session: Session = Depends(get_session)) -> dict:
    return kpis(session)


@router.get("/brief.pdf", dependencies=[Depends(require("reports"))])
def brief(session: Session = Depends(get_session)) -> Response:
    from app.api.missions import missions_with_coverage
    from app.services.logbook_nlp import insights

    k = kpis(session)
    ov = k["overview"]
    as_of = H.as_of(session)
    fleet = H.fleet(session)
    by_base = defaultdict(lambda: [0, 0, 0, 0])
    names = {}
    for ah in fleet:
        b = by_base[ah.base.id]
        names[ah.base.id] = ah.base.name
        b[0] += 1
        b[{"ready": 1, "caution": 2, "grounded": 3}[ah.status]] += 1
    plan, missions = missions_with_coverage(session)
    at_risk = [m for m in missions if (m["shortfall"] or 0) > 0]
    alerts = K.alerts(session, limit=6)
    finds = insights(session)[:4]
    story = [
        Paragraph(
            f"<b>Fleet readiness {ov['readiness_pct']:.1f}%</b> — {ov['mission_capable']} of {ov['total']} aircraft mission-capable "
            f"({ov['ready']} ready, {ov['caution']} caution, {ov['grounded']} grounded). "
            f"{len(at_risk)} mission(s) short of aircraft under the {'AeroPulse plan' if plan == 'aeropulse' else 'reactive baseline'}. "
            f"The optimised plan lifts 30-day average readiness by {k['readiness_gain_pts']:+.1f} points and avoids "
            f"{k['downtime_avoided_aircraft_days']} aircraft-days on the ground.",
            pdf.BODY,
        ),
        Paragraph("Key indicators", pdf.H2),
        pdf.table(
            [
                ["Indicator", "Value", "Note"],
                [
                    "Fleet availability",
                    f"{k['availability_pct']:.1f}%",
                    f"{ov['readiness_delta']:+.1f} pts vs last week" if ov["readiness_delta"] is not None else "",
                ],
                ["Predicted failures (14 d)", str(ov["predicted_failures_14d"]), "components with P50 < 14 days"],
                ["AOG hours (7 d)", f"{ov['aog_hours_week']:.0f}", "aircraft on ground awaiting parts"],
                [
                    "MTBF / MTTR (90 d)",
                    f"{ov['mtbf_hours']:.1f} h / {ov['mttr_hours']:.1f} h",
                    "flight hours per defect / mean repair time",
                ],
                [
                    "Maintenance cost (90 d)",
                    f"Rs {k['maintenance_cost_90d_lakh']:.1f} lakh",
                    "parts + labour (simulated)",
                ],
                [
                    "Prediction accuracy",
                    f"RMSE {k['prediction']['rmse']} cycles",
                    f"{k['prediction']['coverage_pct']}% interval coverage (NASA C-MAPSS FD001)",
                ],
            ],
            widths=[150, 120, 240],
        ),
        Paragraph("Readiness by base", pdf.H2),
        pdf.table(
            [["Base", "Aircraft", "Ready", "Caution", "Grounded", "Mission-capable"]]
            + [
                [names[b], v[0], v[1], v[2], v[3], f"{100 * (v[1] + v[2]) / v[0]:.0f}%"]
                for b, v in sorted(by_base.items(), key=lambda kv: names[kv[0]])
            ]
        ),
        Paragraph("Missions in the next 30 days", pdf.H2),
        pdf.table(
            [["Mission", "Dates", "Required", "Available", "Status"]]
            + [
                [
                    m["name"],
                    f"{m['start_date'][5:]} – {m['end_date'][5:]}",
                    f"{m['required']} × {m['aircraft_type'].split()[0]}",
                    m["available"] if m["available"] is not None else "—",
                    "Grounded" if (m["shortfall"] or 0) > 0 else "Ready",
                ]
                for m in missions
                if m["in_forecast"] and m["end_day"] >= 0
            ][:14],
            widths=[190, 80, 90, 70, 80],
            status_col=4,
        ),
        Paragraph("Priority maintenance actions", pdf.H2),
        pdf.table(
            [["Aircraft", "Base", "Finding", "Due"]]
            + [[a["tail"], a["base_id"], a["headline"], f"≤ {a['due_day']} d"] for a in alerts],
            widths=[60, 45, 330, 60],
        ),
        Paragraph("Findings from logbook and spares analytics", pdf.H2),
        *[Paragraph(f"• {f['message']}", pdf.BODY) for f in finds],
        Spacer(1, 8),
        Paragraph(
            "All fleet data in this brief is simulated for demonstration. Engine predictions use NASA C-MAPSS trajectories.",
            pdf.SMALL,
        ),
    ]
    body = pdf.build("Commander Readiness Brief", f"AeroPulse · as of {as_of:%d %b %Y} · SIH26249", story)
    return Response(
        body,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="aeropulse-brief-{as_of}.pdf"'},
    )


@router.get("/export.csv", dependencies=[Depends(require("reports"))])
def export_csv(
    dataset: str = Query("records", pattern="^(records|fleet|missions)$"), session: Session = Depends(get_session)
) -> Response:
    buf = io.StringIO()
    w = csv.writer(buf)
    if dataset == "records":
        w.writerow(
            [
                "id",
                "date",
                "tail",
                "base",
                "component",
                "defect_code",
                "narrative",
                "action_taken",
                "man_hours",
                "downtime_days",
                "batch",
                "technician",
            ]
        )
        for r in session.exec(select(MaintenanceRecord).order_by(MaintenanceRecord.date)).all():
            w.writerow(
                [
                    r.id,
                    r.date,
                    r.tail,
                    r.base_id,
                    r.component_kind,
                    r.defect_code,
                    r.narrative,
                    r.action_taken,
                    r.man_hours,
                    r.downtime_days,
                    r.batch or "",
                    r.technician,
                ]
            )
    elif dataset == "fleet":
        w.writerow(
            [
                "tail",
                "type",
                "base",
                "status",
                "status_reason",
                "health",
                "lowest_component",
                "lowest_p50_days",
                "next_due",
                "next_due_days",
            ]
        )
        for ah in H.fleet(session):
            w.writerow(
                [
                    ah.aircraft.tail,
                    ah.aircraft.type,
                    ah.base.name,
                    ah.status,
                    ah.status_reason,
                    ah.health,
                    ah.lowest.position,
                    ah.lowest.p50_days,
                    ah.next_due.position,
                    round(ah.next_due.due_days, 1),
                ]
            )
    else:
        from app.api.missions import missions_with_coverage

        _, rows = missions_with_coverage(session)
        w.writerow(["id", "name", "start", "end", "base", "scope", "type", "required", "available", "shortfall"])
        for m in rows:
            w.writerow(
                [
                    m["id"],
                    m["name"],
                    m["start_date"],
                    m["end_date"],
                    m["base_name"],
                    m["scope"],
                    m["aircraft_type"],
                    m["required"],
                    m["available"],
                    m["shortfall"],
                ]
            )
    if not buf.getvalue():
        raise HTTPException(404, "Nothing to export")
    return Response(
        buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="aeropulse-{dataset}.csv"'},
    )
