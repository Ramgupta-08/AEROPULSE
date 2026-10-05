"""Planning core shared by the optimiser, the reactive baseline, forecasts, missions and what-if.

Vocabulary
- *Task*: a unit of maintenance work on one aircraft (open work order, predicted failure, life-limit item).
- *Visit*: one hangar slot for one aircraft, possibly bundling several tasks.
- *Availability*: for each aircraft and day of the horizon, whether it is mission-capable (MC).
Days are integer offsets from the as-of date (day 0 = today).
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field, replace
from datetime import date, timedelta

from sqlmodel import Session, select

from app.models import HangarBay, Mission, Part, ScheduleBlock, StockLevel, TechnicianShift
from app.services import domain as D
from app.services import health as H

HORIZON = 30
FORECAST_DAYS = 30
UNPLANNED_FACTOR = 1.5  # unplanned repairs take longer (troubleshooting, no prepared kit)
REACTIVE_SLOT_DELAY = 1  # reactive work is queued after the failure is reported


@dataclass
class Task:
    id: str
    tail: str
    base_id: str
    aircraft_type: str
    component_id: int | None
    kind: str
    position: str
    title: str
    trade: str
    duration: int
    man_hours: float
    source: str  # work-order | predicted | life-limit
    part_number: str | None = None
    p10_day: float | None = None
    p50_day: float | None = None
    p90_day: float | None = None
    due_day: int = HORIZON  # latest start
    in_work: bool = False
    status: str = ""  # work-order status
    # Part availability (AeroPulse: transfers allowed; reactive: local stock or order)
    earliest_day: int = 0
    part_source: str = "local stock"
    reactive_part_wait: int = 0
    risk: float = 0.0
    critical: bool = False
    elapsed: int = 0  # days the work order has already been open (counts against part lead time)

    def as_dict(self) -> dict:
        return {k: getattr(self, k) for k in self.__dataclass_fields__}


@dataclass
class PlanState:
    as_of: date
    fleet: list[H.AircraftHealth]
    tasks: list[Task]
    bays: dict[str, list[str]]
    trade_hours: dict[tuple[str, str], float]
    missions: list[Mission]
    transfers: list[dict] = field(default_factory=list)
    aircraft_index: dict[str, H.AircraftHealth] = field(default_factory=dict)

    @property
    def tails(self) -> list[str]:
        return [a.aircraft.tail for a in self.fleet]


# ---------------------------------------------------------------- task generation
def build_tasks(fleet: list[H.AircraftHealth], as_of: date, window: int = 20, horizon: int = HORIZON) -> list[Task]:
    tasks: list[Task] = []
    for ah in fleet:
        a = ah.aircraft
        if ah.work_order is not None:
            wo = ah.work_order
            comp = next((c for c in ah.components if c.id == wo.component_id), None)
            tasks.append(
                Task(
                    id=f"WO-{wo.id}",
                    tail=a.tail,
                    base_id=a.base_id,
                    aircraft_type=a.type,
                    component_id=wo.component_id,
                    kind=comp.kind if comp else "airframe",
                    position=comp.position if comp else "Airframe",
                    title=wo.title,
                    trade=wo.trade,
                    duration=max(1, wo.remaining_days),
                    man_hours=wo.man_hours,
                    source="work-order",
                    part_number=wo.part_number,
                    due_day=0,
                    in_work=wo.status == "in-work",
                    status=wo.status,
                    critical=True,
                    elapsed=(as_of - wo.opened_on).days,
                )
            )
        for ch in ah.components:
            if ch.p10_days <= horizon + window and ch.p10_days <= ch.life_due_days:
                if ah.work_order is not None and ah.work_order.component_id == ch.id:
                    continue
                title, dur, mh = D.TASK_SPEC[ch.kind]
                if ch.kind == "engine":
                    title = f"{ch.position}: removal & core module change"
                tasks.append(
                    Task(
                        id=f"PR-{ch.id}",
                        tail=a.tail,
                        base_id=a.base_id,
                        aircraft_type=a.type,
                        component_id=ch.id,
                        kind=ch.kind,
                        position=ch.position,
                        title=title,
                        trade=D.KIND_TRADE[ch.kind],
                        duration=dur,
                        man_hours=mh,
                        source="predicted",
                        part_number=D.task_part(a.type, ch.kind),
                        p10_day=ch.p10_days,
                        p50_day=ch.p50_days,
                        p90_day=ch.p90_days,
                        due_day=max(0, math.floor(ch.p10_days)),
                        critical=ch.kind in ("engine", "flight_controls", "hydraulics"),
                    )
                )
            elif ch.life_due_days <= horizon + window:
                if ch.kind == "landing_gear":
                    title, dur, mh = D.INSPECTION_SPEC
                else:
                    title, dur, mh = D.TASK_SPEC[ch.kind]
                    title = f"{ch.position} life-limit replacement"
                tasks.append(
                    Task(
                        id=f"LL-{ch.id}",
                        tail=a.tail,
                        base_id=a.base_id,
                        aircraft_type=a.type,
                        component_id=ch.id,
                        kind=ch.kind,
                        position=ch.position,
                        title=title,
                        trade=D.KIND_TRADE[ch.kind],
                        duration=dur,
                        man_hours=mh,
                        source="life-limit",
                        part_number=None if ch.kind == "landing_gear" else D.task_part(a.type, ch.kind),
                        due_day=max(0, math.floor(ch.life_due_days)),
                    )
                )
    for t in tasks:
        t.risk = 1.0 if t.source == "work-order" else round(1 / (1 + max(0.0, t.due_day)), 3)
    return tasks


# ---------------------------------------------------------------- spares allocation
def allocate_parts(tasks: list[Task], session: Session, base_names: dict[str, str]) -> list[dict]:
    """Assign each task's part: local stock, inter-base transfer, open order or new order (most urgent first).

    Reactive practice never transfers: it uses local stock or orders at lead time.
    Returns the transfer suggestions made.
    """
    stock: dict[tuple[str, str], int] = {}
    orders: dict[tuple[str, str], tuple[int, date | None]] = {}
    for sl in session.exec(select(StockLevel)).all():
        stock[(sl.part_number, sl.base_id)] = sl.on_hand
        orders[(sl.part_number, sl.base_id)] = (sl.on_order, sl.order_eta)
    parts = {p.part_number: p for p in session.exec(select(Part)).all()}
    as_of = H.as_of(session)
    reactive_stock = dict(stock)
    transfers = []
    ordered = sorted((t for t in tasks if t.part_number), key=lambda t: (t.due_day, -t.risk))
    # Pass 1 — local stock serves local needs first (both practices).
    pending = []
    for t in ordered:
        p = parts.get(t.part_number)
        lead = p.lead_time_days if p else 30
        key = (t.part_number, t.base_id)
        if reactive_stock.get(key, 0) > 0:
            reactive_stock[key] -= 1
            t.reactive_part_wait = 0
        else:
            q, eta = orders.get(key, (0, None))
            t.reactive_part_wait = (eta - as_of).days if q and eta else max(0, lead - t.elapsed)
        if stock.get(key, 0) > 0:
            stock[key] -= 1
            t.earliest_day, t.part_source = 0, "local stock"
        else:
            pending.append(t)
    # Pass 2 — AeroPulse only: transfer from the base with most spare stock, else open order, else lead time.
    for t in pending:
        p = parts.get(t.part_number)
        lead = p.lead_time_days if p else 30
        key = (t.part_number, t.base_id)
        donors = sorted(
            ((b, n) for (pn, b), n in stock.items() if pn == t.part_number and b != t.base_id and n > 0),
            key=lambda bn: -bn[1],
        )
        q, eta = orders.get(key, (0, None))
        order_day = (eta - as_of).days if q and eta else None
        if donors and (order_day is None or order_day > D.TRANSFER_DAYS):
            donor, n = donors[0]
            stock[(t.part_number, donor)] -= 1
            t.earliest_day = D.TRANSFER_DAYS
            t.part_source = f"transfer from {base_names[donor]}"
            transfers.append(
                {
                    "part_number": t.part_number,
                    "part_name": p.name if p else t.part_number,
                    "from_base": donor,
                    "to_base": t.base_id,
                    "from_name": base_names[donor],
                    "to_name": base_names[t.base_id],
                    "donor_on_hand": n,
                    "need_day": t.due_day,
                    "tail": t.tail,
                    "task": t.title,
                    "transfer_days": D.TRANSFER_DAYS,
                    "lead_time_days": lead,
                    "days_saved": max(
                        0, (order_day if order_day is not None else max(0, lead - t.elapsed)) - D.TRANSFER_DAYS
                    ),
                    "unit_cost": p.unit_cost if p else 0,
                }
            )
        elif order_day is not None:
            t.earliest_day, t.part_source = order_day, f"on order (ETA day {order_day})"
        else:
            wait = max(0, lead - t.elapsed)
            t.earliest_day, t.part_source = wait, f"on order — arrives in {wait} d"
    return transfers


# ---------------------------------------------------------------- state
def load_state(
    session: Session, window: int = 20, horizon: int = HORIZON, fleet: list[H.AircraftHealth] | None = None
) -> PlanState:
    fleet = fleet if fleet is not None else H.fleet(session)
    tasks = build_tasks(fleet, H.as_of(session), window, horizon)
    base_names = {ah.base.id: ah.base.name for ah in fleet}
    transfers = allocate_parts(tasks, session, base_names)
    bays: dict[str, list[str]] = defaultdict(list)
    for b in session.exec(select(HangarBay).order_by(HangarBay.id)).all():
        bays[b.base_id].append(b.id)
    trade_hours = {
        (s.base_id, s.trade): s.technicians * s.hours_per_day for s in session.exec(select(TechnicianShift)).all()
    }
    missions = list(session.exec(select(Mission).order_by(Mission.start_date)).all())
    st = PlanState(H.as_of(session), fleet, tasks, dict(bays), trade_hours, missions, transfers)
    st.aircraft_index = {ah.aircraft.tail: ah for ah in fleet}
    return st


# ---------------------------------------------------------------- availability
Intervals = dict[str, list[tuple[int, int, str]]]  # tail -> [(start, end_exclusive, reason)]


def mc_matrix(state: PlanState, down: Intervals, days: int) -> dict[str, list[bool]]:
    out = {}
    for tail in state.tails:
        row = [True] * days
        for s, e, _ in down.get(tail, []):
            for d in range(max(0, s), min(days, e)):
                row[d] = False
        out[tail] = row
    return out


def counts(
    state: PlanState, mc: dict[str, list[bool]], days: int, aircraft_type: str | None = None, base_id: str | None = None
) -> list[int]:
    res = [0] * days
    for ah in state.fleet:
        a = ah.aircraft
        if aircraft_type and a.type != aircraft_type:
            continue
        if base_id and a.base_id != base_id:
            continue
        for d, ok in enumerate(mc[a.tail]):
            res[d] += ok
    return res


def mission_demand(state: PlanState, day: int, aircraft_type: str | None = None, base_id: str | None = None) -> int:
    """Aircraft required on a day. With a base filter only that base's own missions count."""
    dd = state.as_of + timedelta(days=day)
    return sum(
        m.required_count
        for m in state.missions
        if m.start_date <= dd <= m.end_date
        and (aircraft_type is None or m.aircraft_type == aircraft_type)
        and (base_id is None or (m.scope == "base" and m.base_id == base_id))
    )


def mission_shortfalls(state: PlanState, mc: dict[str, list[bool]], days: int) -> list[dict]:
    """Per mission: worst-day shortfall given availability. Base missions count aircraft at that base; fleet
    missions count aircraft of the type anywhere, after base missions of the same type have taken theirs."""
    out = []
    by_type_base = {}
    for m in state.missions:
        s = (m.start_date - state.as_of).days
        e = (m.end_date - state.as_of).days
        if e < 0 or s >= days:
            continue
        worst = None
        for d in range(max(0, s), min(days, e + 1)):
            if m.scope == "base":
                key = (m.aircraft_type, m.base_id)
                if key not in by_type_base:
                    by_type_base[key] = counts(state, mc, days, m.aircraft_type, m.base_id)
                avail = by_type_base[key][d]
            else:
                key = (m.aircraft_type, None)
                if key not in by_type_base:
                    by_type_base[key] = counts(state, mc, days, m.aircraft_type)
                dd = state.as_of + timedelta(days=d)
                other = sum(
                    o.required_count
                    for o in state.missions
                    if o is not m and o.aircraft_type == m.aircraft_type and o.start_date <= dd <= o.end_date
                )
                avail = by_type_base[key][d] - other
            short = max(0, m.required_count - avail)
            if worst is None or short > worst[0] or (short == worst[0] and avail < worst[1]):
                worst = (short, avail, d)
        out.append(
            {
                "mission_id": m.id,
                "name": m.name,
                "required": m.required_count,
                "available": max(0, worst[1]),
                "shortfall": worst[0],
                "worst_day": worst[2],
                "covered": worst[0] == 0,
            }
        )
    return out


# ---------------------------------------------------------------- reactive baseline
def simulate_reactive(
    state: PlanState, days: int = FORECAST_DAYS, failure_q: str = "p50"
) -> tuple[Intervals, list[dict]]:
    """Reactive practice: fly until failure, then wait for parts and a free bay; life-limit items are
    done individually on their due date; open work orders proceed first-come-first-served."""
    events = []  # (ready_day, priority, task, duration)
    down: Intervals = defaultdict(list)
    for t in state.tasks:
        if t.source == "work-order":
            if t.in_work:
                events.append((0, 0, t, t.duration, 0))
            else:
                wait = t.reactive_part_wait if t.status == "awaiting-part" else 0
                events.append((wait, 1, t, t.duration, 0))
        elif t.source == "predicted":
            fail = getattr(t, f"{failure_q}_day")
            if fail is None or fail >= days:
                continue
            fd = max(0, math.floor(fail))
            events.append(
                (fd + REACTIVE_SLOT_DELAY + t.reactive_part_wait, 2, t, math.ceil(t.duration * UNPLANNED_FACTOR), fd)
            )
        else:  # life-limit: grounded on the due date, done on its own
            if t.due_day >= days:
                continue
            events.append((t.due_day + t.reactive_part_wait, 2, t, t.duration, t.due_day))
    # FIFO over bays per base
    bay_free: dict[str, list[int]] = {b: [0] * len(v) for b, v in state.bays.items()}
    visits = []
    for ready, _, t, dur, ground_from in sorted(events, key=lambda e: (e[0], e[1], e[2].due_day)):
        frees = bay_free.setdefault(t.base_id, [0])
        i = min(range(len(frees)), key=lambda k: frees[k])
        start = max(ready, frees[i])
        frees[i] = start + dur
        g = 0 if t.source == "work-order" else ground_from
        down[t.tail].append((g, start + dur, t.title))
        visits.append(
            {
                "tail": t.tail,
                "base_id": t.base_id,
                "bay_index": i,
                "start": start,
                "end": start + dur,
                "grounded_from": g,
                "task": t.title,
                "task_id": t.id,
                "source": t.source,
            }
        )
    return dict(down), visits


# ---------------------------------------------------------------- plan-based availability
def plan_downtime(state: PlanState, blocks: list[dict], days: int = FORECAST_DAYS, failure_q: str = "p50") -> Intervals:
    """Downtime under a planned schedule. Unplanned predicted tasks still fail (reactively) at their quantile."""
    down: Intervals = defaultdict(list)
    planned: set[str] = set()
    wo_tails = {t.tail for t in state.tasks if t.source == "work-order"}
    for b in blocks:
        start, end = b["start_day"], b["start_day"] + b["duration_days"]
        from_ = 0 if b["tail"] in wo_tails and any(x.get("source") == "work-order" for x in b["tasks"]) else start
        down[b["tail"]].append((from_, end, "planned"))
        planned.update(x["id"] for x in b["tasks"])
        for x in b["tasks"]:  # failure before the visit
            q = x.get(f"{failure_q}_day")
            if x.get("source") == "predicted" and q is not None and q < start:
                down[b["tail"]].append((math.floor(q), end, "failed before visit"))
    leftover = [t for t in state.tasks if t.id not in planned]
    if leftover:
        sub = replace(state, tasks=leftover)
        extra, _ = simulate_reactive(sub, days, failure_q)
        for tail, iv in extra.items():
            down[tail].extend(iv)
    return dict(down)


def active_plan(session: Session, plan: str = "aeropulse") -> list[dict]:
    rows = session.exec(select(ScheduleBlock).where(ScheduleBlock.plan == plan).order_by(ScheduleBlock.start_day)).all()
    return [
        {
            "id": r.id,
            "tail": r.tail,
            "base_id": r.base_id,
            "bay_id": r.bay_id,
            "start_day": r.start_day,
            "duration_days": r.duration_days,
            "tasks": r.tasks,
            "bundled_count": r.bundled_count,
            "locked": r.locked,
        }
        for r in rows
    ]


def forecast(
    state: PlanState, blocks: list[dict] | None, days: int = FORECAST_DAYS, base_id: str | None = None
) -> dict:
    """MC per day (central P50 failures, band from P10 / P90 failure timing), per type, plus demand."""
    series = {}
    for q in ("p10", "p50", "p90"):
        down = plan_downtime(state, blocks, days, q) if blocks else simulate_reactive(state, days, q)[0]
        series[q] = mc_matrix(state, down, days)
    out = {"days": [(state.as_of + timedelta(days=d)).isoformat() for d in range(days)], "types": {}}
    for typ in [None, *D.TYPES]:
        key = typ or "all"
        lo = counts(state, series["p10"], days, typ, base_id)
        mid = counts(state, series["p50"], days, typ, base_id)
        hi = counts(state, series["p90"], days, typ, base_id)
        demand = [mission_demand(state, d, typ, base_id) for d in range(days)]
        out["types"][key] = {
            "total": sum(
                1
                for ah in state.fleet
                if (typ is None or ah.aircraft.type == typ) and (not base_id or ah.aircraft.base_id == base_id)
            ),
            "p50": mid,
            "low": [min(a, b) for a, b in zip(lo, mid, strict=True)],
            "high": [max(a, b) for a, b in zip(hi, mid, strict=True)],
            "demand": demand,
            "shortfall_days": [d for d in range(days) if demand[d] > mid[d]],
        }
    out["mc_p50"] = series["p50"]
    return out


def summarise(state: PlanState, down: Intervals, days: int = HORIZON) -> dict:
    mc = mc_matrix(state, down, days)
    daily = counts(state, mc, days)
    groundings = sum(len(v) for v in down.values())
    downtime = sum(sum(1 for ok in row if not ok) for row in mc.values())
    shortfalls = mission_shortfalls(state, mc, days)
    return {
        "daily_mc": daily,
        "min_mc": min(daily),
        "avg_mc": round(sum(daily) / days, 1),
        "avg_readiness_pct": round(100 * sum(daily) / days / len(state.fleet), 1),
        "groundings": groundings,
        "downtime_aircraft_days": downtime,
        "missions_short": sum(1 for s in shortfalls if not s["covered"]),
        "missions_total": len(shortfalls),
        "mission_shortfall_aircraft": sum(s["shortfall"] for s in shortfalls),
        "missions": shortfalls,
    }
