from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, func, select

from app.core.auth import DEMO_USERS, Role, require
from app.core.config import ARTIFACTS_DIR
from app.core.db import get_session
from app.ml import cmapss
from app.models import Component, PredictionFeedback
from app.services import domain as D
from app.services import health as H
from app.services import rul as R
from app.services.anomaly import score_engine
from app.services.hashchain import append

router = APIRouter(prefix="/api", tags=["predictive health"])


class Reason(BaseModel):
    sensor: str
    name: str
    text: str
    impact: float


class EngineOut(BaseModel):
    component_id: int
    tail: str
    aircraft_type: str
    base_id: str
    position: str
    serial: str
    engine_ref: str
    sorties_since_overhaul: int
    p10: float
    p50: float
    p90: float
    p10_days: float
    p50_days: float
    p90_days: float
    health: float
    tone: str
    reasons: list[Reason]
    anomaly: bool


@router.get("/health/engines", response_model=list[EngineOut], dependencies=[Depends(require("health"))])
def engines(base_id: str | None = None, session: Session = Depends(get_session)) -> list[EngineOut]:
    out = []
    for ah in H.fleet(session, base_id=base_id):
        for ch in ah.components:
            if ch.kind != "engine" or ch.engine_ref is None:
                continue
            comp = session.get(Component, ch.id)
            t = R.track(comp.cmapss_dataset, comp.cmapss_unit, comp.telemetry_injection)
            reasons = R.reasons(t, top=3) if ch.p50 < 60 else []
            an = score_engine(t, ch.p50)
            out.append(
                EngineOut(
                    component_id=ch.id,
                    tail=ch.tail,
                    aircraft_type=ah.aircraft.type,
                    base_id=ah.base.id,
                    position=ch.position,
                    serial=ch.serial,
                    engine_ref=ch.engine_ref,
                    sorties_since_overhaul=ch.cycle or 0,
                    p10=ch.p10,
                    p50=ch.p50,
                    p90=ch.p90,
                    p10_days=ch.p10_days,
                    p50_days=ch.p50_days,
                    p90_days=ch.p90_days,
                    health=ch.health,
                    tone=H.tone(ch.health),
                    reasons=[Reason(**{k: r[k] for k in Reason.model_fields}) for r in reasons],
                    anomaly=bool(an and an["flagged"]),
                )
            )
    out.sort(key=lambda e: e.p50)
    return out


class AnomalySensor(BaseModel):
    sensor: str
    name: str
    z: float
    volatility_ratio: float
    kind: str


class AnomalyOut(BaseModel):
    component_id: int
    tail: str
    base_id: str
    position: str
    score: float
    threshold: float
    flagged: bool
    p50: float
    message: str
    sensors: list[AnomalySensor]


@router.get("/anomalies", response_model=list[AnomalyOut], dependencies=[Depends(require("health"))])
def anomalies(include_normal: bool = False, session: Session = Depends(get_session)) -> list[AnomalyOut]:
    out = []
    for ah in H.fleet(session):
        for ch in ah.components:
            if ch.kind != "engine" or ch.engine_ref is None:
                continue
            comp = session.get(Component, ch.id)
            t = R.track(comp.cmapss_dataset, comp.cmapss_unit, comp.telemetry_injection)
            an = score_engine(t, ch.p50)
            if an is None or (not an["flagged"] and not include_normal):
                continue
            involved = ", ".join(s["name"].lower() for s in an["sensors"][:2])
            msg = (
                f"Unusual behaviour — doesn't match known degradation ({involved})"
                if an["flagged"]
                else "Behaviour consistent with known degradation"
            )
            out.append(
                AnomalyOut(
                    component_id=ch.id,
                    tail=ch.tail,
                    base_id=ah.base.id,
                    position=ch.position,
                    score=an["score"],
                    threshold=an["threshold"],
                    flagged=an["flagged"],
                    p50=ch.p50,
                    message=msg,
                    sensors=an["sensors"],
                )
            )
    out.sort(key=lambda a: a.score)
    return out


class FeedbackIn(BaseModel):
    component_id: int
    verdict: str = Field(pattern="^(correct|early|late)$")
    note: str = ""


class FeedbackOut(BaseModel):
    id: int
    verdict: str
    created_at: datetime


@router.post("/health/feedback", response_model=FeedbackOut)
def feedback(
    body: FeedbackIn, role: Role = Depends(require("health_write")), session: Session = Depends(get_session)
) -> FeedbackOut:
    comp = session.get(Component, body.component_id)
    if comp is None:
        raise HTTPException(404, "Component not found")
    ah = next(a for a in H.fleet(session) if a.aircraft.tail == comp.tail)
    ch = next(c for c in ah.components if c.id == comp.id)
    fb = PredictionFeedback(
        component_id=comp.id,
        tail=comp.tail,
        verdict=body.verdict,
        predicted_p50=ch.p50,
        note=body.note,
        user=DEMO_USERS[role],
    )
    session.add(fb)
    append(
        session,
        actor=DEMO_USERS[role],
        role=role.value,
        action="prediction.feedback",
        entity_type="component",
        entity_id=str(comp.id),
        tail=comp.tail,
        summary=f"Prediction marked {body.verdict} for {comp.tail} {comp.position}",
        payload={"component_id": comp.id, "verdict": body.verdict, "predicted_p50": ch.p50, "note": body.note},
    )
    session.commit()
    session.refresh(fb)
    return FeedbackOut(id=fb.id, verdict=fb.verdict, created_at=fb.created_at)


@router.get("/health/model-card", dependencies=[Depends(require("health"))])
def model_card(session: Session = Depends(get_session)) -> dict:
    path = ARTIFACTS_DIR / "metrics.json"
    if not path.exists():
        raise HTTPException(503, "Models not trained yet — run `make train`.")
    m = json.loads(path.read_text())
    counts = dict(
        session.exec(select(PredictionFeedback.verdict, func.count()).group_by(PredictionFeedback.verdict)).all()
    )
    total = sum(counts.values())
    recent = session.exec(select(PredictionFeedback).order_by(PredictionFeedback.created_at.desc()).limit(8)).all()  # type: ignore[union-attr]
    for d in m["datasets"]:
        d["sensors_used_named"] = [{"sensor": s, "name": cmapss.SENSOR_NAMES[s]} for s in d["sensors_used"]]
    return {
        **m,
        "fleet_datasets": ["FD001", "FD003"],
        "assumptions": [
            "1 engine cycle in C-MAPSS ≈ 1 flight sortie; RUL in sorties is converted to days with each aircraft's sortie rate.",
            "Remaining useful life targets are capped at 125 cycles (piecewise-linear degradation), standard for C-MAPSS.",
            "P10–P90 bands are conformalised on grouped cross-validation so they reach ≈80 % coverage on unseen engines.",
            "Fleet engines are mapped to held-out C-MAPSS test engines; their true failure point is known but never shown to the model.",
            "Non-engine components use a condition wear model with documented environment and sortie-profile multipliers.",
        ],
        "limitations": [
            "C-MAPSS is a simulated turbofan; real engines need retraining on their own health-monitoring data.",
            "Single-fault-mode data (FD001) under-represents interacting faults; FD003 adds a second fault mode.",
            "Vibration and oil pressure in live telemetry are derived signals for demonstration, not C-MAPSS sensors.",
            "Intervals widen for engines early in life, where little degradation signal exists.",
        ],
        "environment_multipliers": D.ENV_MULTIPLIERS,
        "environment_notes": D.ENV_NOTES,
        "profile_multipliers": D.PROFILE_MULTIPLIERS,
        "profile_notes": D.PROFILE_NOTES,
        "feedback": {
            "total": total,
            "correct": counts.get("correct", 0),
            "early": counts.get("early", 0),
            "late": counts.get("late", 0),
            "accuracy_pct": round(100 * counts.get("correct", 0) / total, 1) if total else None,
            "recent": [
                {
                    "tail": f.tail,
                    "verdict": f.verdict,
                    "predicted_p50": f.predicted_p50,
                    "user": f.user,
                    "created_at": f.created_at.isoformat(),
                }
                for f in recent
            ],
        },
    }


@router.get("/health/adjustments", dependencies=[Depends(require("health"))])
def adjustments(session: Session = Depends(get_session)) -> list[dict]:
    """Non-engine components whose wear is adjusted for environment or sortie profile, most affected first."""
    rows = []
    for ah in H.fleet(session):
        for ch in ah.components:
            if ch.kind == "engine" or (ch.env_multiplier == 1 and ch.profile_multiplier == 1):
                continue
            rows.append(
                {
                    "component_id": ch.id,
                    "tail": ch.tail,
                    "base_id": ah.base.id,
                    "environment": ah.base.environment,
                    "sortie_profile": ah.aircraft.sortie_profile,
                    "position": ch.position,
                    "env_multiplier": ch.env_multiplier,
                    "profile_multiplier": ch.profile_multiplier,
                    "combined": round(ch.env_multiplier * ch.profile_multiplier, 2),
                    "p50_days": ch.p50_days,
                    "unadjusted_p50_days": round(ch.p50_days * ch.env_multiplier * ch.profile_multiplier, 1),
                    "note": ch.adjustment_note,
                }
            )
    rows.sort(key=lambda r: -r["combined"])
    return rows
