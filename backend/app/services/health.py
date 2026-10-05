"""Component and aircraft health: RUL with confidence, life-limit usage, environment/profile adjustment.

Engines: LightGBM quantile RUL on the engine's C-MAPSS trajectory (1 cycle ≈ 1 sortie).
Other components: condition-based wear model, adjusted by documented base-environment and sortie-profile
multipliers (see services/domain.py) and bounded by hard life limits (hours / cycles / calendar).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date

from sqlmodel import Session, select

from app.models import Aircraft, Base, Component, Meta, WorkOrder
from app.services import domain as D
from app.services import rul as R

# Interval half-widths for the condition model (P10 earlier / P90 later than P50).
COND_P10, COND_P90 = 0.75, 1.30
CAUTION_P10_DAYS = 21
CAUTION_HEALTH = 55


def health_from_days(days: float) -> float:
    """0–100 score from P50 remaining life in days (100 at ≥ 180 days)."""
    if days <= 0:
        return 0.0
    return round(100 * min(1.0, days / 180) ** 0.5, 1)


def tone(score: float) -> str:
    return "ready" if score >= 75 else "caution" if score >= 50 else "grounded"


@dataclass
class ComponentHealth:
    id: int
    tail: str
    kind: str
    position: str
    part_number: str
    serial: str
    batch: str
    supplier: str
    installed_on: date
    health: float
    p10_days: float
    p50_days: float
    p90_days: float
    rul_unit: str  # "sorties" (engines) or "days"
    p10: float
    p50: float
    p90: float
    life_due_days: float
    life_usage: dict
    env_multiplier: float = 1.0
    profile_multiplier: float = 1.0
    adjustment_note: str = ""
    model: str = ""
    engine_ref: str | None = None
    cycle: int | None = None
    failed: bool = False
    extra: dict = field(default_factory=dict)

    @property
    def due_days(self) -> float:
        """Latest sensible service point: P10 failure or hard life limit, whichever first."""
        return min(self.p10_days, self.life_due_days)


def life_usage(c: Component, a: Aircraft, as_of: date, day_offset: int = 0) -> tuple[dict, float]:
    spec = D.TYPES[a.type]
    days_installed = (as_of - c.installed_on).days + day_offset
    cycles = c.cycles_since_install + a.sorties_per_day * day_offset
    hours = c.hours_since_install + a.sorties_per_day * spec["hours_per_sortie"] * day_offset
    usage = {
        "hours": {
            "used": round(max(0.0, hours), 1),
            "limit": c.life_limit_hours,
            "pct": round(100 * max(0.0, hours) / c.life_limit_hours, 1),
        },
        "cycles": {
            "used": int(max(0, cycles)),
            "limit": c.life_limit_cycles,
            "pct": round(100 * max(0, cycles) / c.life_limit_cycles, 1),
        },
        "calendar": {
            "used": max(0, days_installed),
            "limit": c.life_limit_days,
            "pct": round(100 * max(0, days_installed) / c.life_limit_days, 1),
        },
    }
    per_day_hours = a.sorties_per_day * spec["hours_per_sortie"]
    due = min(
        (c.life_limit_hours - hours) / per_day_hours if per_day_hours else 1e9,
        (c.life_limit_cycles - cycles) / a.sorties_per_day if a.sorties_per_day else 1e9,
        c.life_limit_days - days_installed,
    )
    return usage, round(due, 1)


def component_health(c: Component, a: Aircraft, b: Base, as_of: date, day_offset: int = 0) -> ComponentHealth:
    usage, due = life_usage(c, a, as_of, day_offset)
    common = dict(
        id=c.id,
        tail=c.tail,
        kind=c.kind,
        position=c.position,
        part_number=c.part_number,
        serial=c.serial,
        batch=c.batch,
        supplier=c.supplier,
        installed_on=c.installed_on,
        life_usage=usage,
        life_due_days=due,
    )
    if c.kind == "engine" and c.cmapss_unit is not None and R.models_ready():
        t = R.track(c.cmapss_dataset, c.cmapss_unit, c.telemetry_injection)
        spd = a.sorties_per_day
        shift = round(day_offset * spd)
        if shift <= 0:
            p = R.predict_at(t, max(1, len(t.pred) + shift))
        else:
            now = R.predict_at(t)
            p = {"cycle": now["cycle"], **{k: max(0.0, now[k] - shift) for k in ("p10", "p50", "p90")}}
        days = {k: p[k] / spd for k in ("p10", "p50", "p90")}
        h = health_from_days(days["p50"])
        return ComponentHealth(
            **common,
            health=h,
            p10_days=round(days["p10"], 1),
            p50_days=round(days["p50"], 1),
            p90_days=round(days["p90"], 1),
            rul_unit="sorties",
            p10=round(p["p10"], 1),
            p50=round(p["p50"], 1),
            p90=round(p["p90"], 1),
            model="LightGBM quantile RUL",
            engine_ref=f"{c.cmapss_dataset} unit {c.cmapss_unit}",
            cycle=p["cycle"] + max(0, shift),
            failed=p["p50"] <= 0,
        )
    m_env, m_prof = D.wear_multiplier(c.kind, b.environment, a.sortie_profile)
    eff = max(1e-6, c.wear_per_day * m_env * m_prof)
    cond = min(100.0, c.condition - eff * day_offset)
    p50 = (cond - D.FAILURE_THRESHOLD) / eff
    p10, p90 = p50 * COND_P10, p50 * COND_P90
    notes = []
    if m_env != 1:
        notes.append(f"{b.environment} ×{m_env:.2f}")
    if m_prof != 1:
        notes.append(f"{a.sortie_profile} ×{m_prof:.2f}")
    return ComponentHealth(
        **common,
        health=health_from_days(p50),
        p10_days=round(p10, 1),
        p50_days=round(p50, 1),
        p90_days=round(p90, 1),
        rul_unit="days",
        p10=round(p10, 1),
        p50=round(p50, 1),
        p90=round(p90, 1),
        env_multiplier=m_env,
        profile_multiplier=m_prof,
        adjustment_note=", ".join(notes) or "no adjustment",
        model="Condition wear model",
        failed=p50 <= 0,
        extra={"condition": round(cond, 1), "wear_per_day": round(eff, 4)},
    )


@dataclass
class AircraftHealth:
    aircraft: Aircraft
    base: Base
    components: list[ComponentHealth]
    work_order: WorkOrder | None
    health: float
    status: str
    status_reason: str
    lowest: ComponentHealth
    next_due: ComponentHealth


def aircraft_health(
    a: Aircraft, b: Base, comps: list[Component], wo: WorkOrder | None, as_of: date, day_offset: int = 0
) -> AircraftHealth:
    ch = [component_health(c, a, b, as_of, day_offset) for c in comps]
    scores = [c.health for c in ch]
    score = round(0.7 * min(scores) + 0.3 * sum(scores) / len(scores), 1)
    lowest = min(ch, key=lambda c: c.p50_days)
    nxt = min(ch, key=lambda c: c.due_days)
    if wo is not None and day_offset == 0:
        status, reason = "grounded", wo.title
    elif lowest.failed:
        status, reason = "grounded", f"{lowest.position} predicted failed"
    elif nxt.due_days <= CAUTION_P10_DAYS or score < CAUTION_HEALTH:
        status = "caution"
        reason = (
            f"{nxt.position} due in {max(0, math.floor(nxt.due_days))} days"
            if nxt.due_days <= CAUTION_P10_DAYS
            else f"Health {score:.0f}/100"
        )
    else:
        status, reason = "ready", ""
    return AircraftHealth(a, b, ch, wo, score, status, reason, lowest, nxt)


def as_of(session: Session) -> date:
    m = session.get(Meta, "as_of")
    return date.fromisoformat(m.value) if m else date.today()


def fleet(session: Session, day_offset: int = 0, base_id: str | None = None) -> list[AircraftHealth]:
    today = as_of(session)
    bases = {b.id: b for b in session.exec(select(Base)).all()}
    comps: dict[str, list[Component]] = {}
    for c in session.exec(select(Component).order_by(Component.id)).all():
        comps.setdefault(c.tail, []).append(c)
    wos = {w.tail: w for w in session.exec(select(WorkOrder)).all()}
    q = select(Aircraft).order_by(Aircraft.tail)
    if base_id:
        q = q.where(Aircraft.base_id == base_id)
    return [
        aircraft_health(a, bases[a.base_id], comps.get(a.tail, []), wos.get(a.tail), today, day_offset)
        for a in session.exec(q).all()
    ]
