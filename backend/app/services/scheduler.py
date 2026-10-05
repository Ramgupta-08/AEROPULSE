"""Readiness-first maintenance scheduler (Google OR-Tools CP-SAT).

Decision: the start day of every hangar visit (see bundling.py) inside a 30-day horizon.
Constraints
- hangar bays per base (cumulative, one bay per visit; capacity can be reduced by scenarios)
- technician hours per base and trade per day (cumulative; a visit loads every trade it needs)
- spare-part availability: a visit cannot start before all of its parts are on site (local / transfer / order)
- deadline: start no later than the earliest P10 failure point or hard life limit of its tasks (soft, heavily
  penalised, so infeasible parts situations still yield a plan that shows the violation)
- aircraft on the ground today stay down until their visit completes
Objective (lexicographic weights)
- maximise the minimum daily mission-capable count over the horizon
- mission-aware mode: minimise priority-weighted mission shortfall (pulls critical work before surge days)
- maximise total mission-capable aircraft-days; never miss a deadline unless unavoidable
"""

from __future__ import annotations

import math
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import timedelta

from ortools.sat.python import cp_model

from app.services.bundling import Visit, build_visits
from app.services.planning import HORIZON, PlanState

PRIORITY_WEIGHT = {1: 3, 2: 2, 3: 1}


@dataclass
class Constraints:
    """Scenario-level changes to resources (used by the What-If simulator)."""

    bay_loss: list[tuple[str, int, int, int]] = field(default_factory=list)  # base, from_day, to_day, bays lost
    tech_factor: float = 1.0
    forced: list[tuple[str, int, int]] = field(default_factory=list)  # tail, start_day, duration


def _trade_demand(v: Visit) -> dict[str, int]:
    dur = v.duration
    return {trade: math.ceil(mh / dur) for trade, mh in v.trade_load().items()}


def optimise(
    state: PlanState,
    *,
    mission_aware: bool = True,
    window: int = 20,
    bundling: bool = True,
    constraints: Constraints | None = None,
    time_limit: float = 8.0,
    horizon: int = HORIZON,
) -> dict:
    t0 = time.time()
    c = constraints or Constraints()
    visits, bundle_summary = build_visits(state.tasks, window, horizon, bundling)
    for tail, start, dur in c.forced:
        ah = state.aircraft_index.get(tail)
        if ah is None:
            continue
        visits.append(
            Visit(
                id=f"F-{tail}-{start}",
                tail=tail,
                base_id=ah.aircraft.base_id,
                aircraft_type=ah.aircraft.type,
                tasks=[],
                anchor_ids=set(),
                earliest=start,
                due=None,
                fixed_start=start,
                forced_duration=dur,
            )
        )
    m = cp_model.CpModel()
    H = horizon
    big = H + 40
    starts, ends, intervals, late = {}, {}, {}, {}
    for v in visits:
        dur = v.duration
        if v.fixed_start is not None:
            s = m.NewConstant(v.fixed_start)
        else:
            s = m.NewIntVar(min(v.earliest, big), big, f"s_{v.id}")
        e = m.NewIntVar(0, big + dur, f"e_{v.id}")
        m.Add(e == s + dur)
        starts[v.id], ends[v.id] = s, e
        intervals[v.id] = m.NewIntervalVar(s, dur, e, f"i_{v.id}")
        if v.due is not None:
            lt = m.NewIntVar(0, big, f"late_{v.id}")
            m.Add(lt >= s - v.due)
            late[v.id] = lt

    # Hangar bays per base (+ scenario bay losses as fixed blocking intervals)
    by_base: dict[str, list[Visit]] = defaultdict(list)
    for v in visits:
        by_base[v.base_id].append(v)
    for base, vs in by_base.items():
        cap = len(state.bays.get(base, [])) or 1
        ivs = [intervals[v.id] for v in vs]
        dem = [1] * len(vs)
        for b, fr, to, n in c.bay_loss:
            if b == base and n > 0:
                ivs.append(m.NewIntervalVar(fr, max(1, to - fr), to, f"bayloss_{b}_{fr}"))
                dem.append(min(n, cap))
        m.AddCumulative(ivs, dem, cap)
        # Technician hours per trade
        for trade in ("engine", "airframe", "avionics"):
            cap_h = int(state.trade_hours.get((base, trade), 48) * c.tech_factor)
            ivs_t, dem_t = [], []
            for v in vs:
                d = _trade_demand(v).get(trade) if v.tasks else None
                if d:
                    ivs_t.append(intervals[v.id])
                    dem_t.append(min(d, cap_h))
            if ivs_t:
                m.AddCumulative(ivs_t, dem_t, max(cap_h, 1))

    # Daily availability
    tails_by_visit: dict[str, list[Visit]] = defaultdict(list)
    for v in visits:
        tails_by_visit[v.tail].append(v)
    busy: dict[tuple[str, int], cp_model.IntVar] = {}
    for tail, vs in tails_by_visit.items():
        for d in range(H):
            lits = []
            for v in vs:
                dur = v.duration
                s = starts[v.id]
                after_start = m.NewBoolVar("")
                before_end = m.NewBoolVar("")
                m.Add(s <= d).OnlyEnforceIf(after_start)
                m.Add(s >= d + 1).OnlyEnforceIf(after_start.Not())
                m.Add(s + dur >= d + 1).OnlyEnforceIf(before_end)
                m.Add(s + dur <= d).OnlyEnforceIf(before_end.Not())
                if v.grounded_now:
                    lits.append(before_end)  # grounded from today until the work completes
                else:
                    x = m.NewBoolVar("")
                    m.AddBoolAnd([after_start, before_end]).OnlyEnforceIf(x)
                    m.AddBoolOr([after_start.Not(), before_end.Not()]).OnlyEnforceIf(x.Not())
                    lits.append(x)
            b = m.NewBoolVar(f"busy_{tail}_{d}")
            m.AddMaxEquality(b, lits)
            busy[(tail, d)] = b

    def mc(day: int, typ: str | None = None, base: str | None = None):
        terms = []
        n = 0
        for ah in state.fleet:
            a = ah.aircraft
            if (typ and a.type != typ) or (base and a.base_id != base):
                continue
            n += 1
            if (a.tail, day) in busy:
                terms.append(busy[(a.tail, day)])
        return n - sum(terms) if terms else n

    min_mc = m.NewIntVar(0, len(state.fleet), "min_mc")
    total_mc = []
    for d in range(H):
        expr = mc(d)
        m.Add(min_mc <= expr)
        total_mc.append(expr)

    shortfall_terms = []
    for ms in state.missions:
        s = (ms.start_date - state.as_of).days
        e = (ms.end_date - state.as_of).days
        for d in range(max(0, s), min(H, e + 1)):
            if ms.scope == "base":
                avail = mc(d, ms.aircraft_type, ms.base_id)
            else:
                dd = state.as_of + timedelta(days=d)
                other = sum(
                    o.required_count
                    for o in state.missions
                    if o is not ms and o.aircraft_type == ms.aircraft_type and o.start_date <= dd <= o.end_date
                )
                avail = mc(d, ms.aircraft_type) - other
            sf = m.NewIntVar(0, ms.required_count, f"sf_{ms.id}_{d}")
            m.Add(sf >= ms.required_count - avail)
            shortfall_terms.append(PRIORITY_WEIGHT[ms.priority] * sf)

    # Mission-aware: keep aircraft that could fly a mission out of the hangar on its days (margin, not just
    # coverage) — this defers non-critical work away from surge days and pulls critical work earlier.
    surge_terms = []
    if mission_aware:
        for ms in state.missions:
            s = (ms.start_date - state.as_of).days
            e = (ms.end_date - state.as_of).days
            if e - s > 14:
                continue  # standing duties are covered by the shortfall term
            for ah in state.fleet:
                a = ah.aircraft
                if a.type != ms.aircraft_type or (ms.scope == "base" and a.base_id != ms.base_id):
                    continue
                for d in range(max(0, s), min(H, e + 1)):
                    if (a.tail, d) in busy:
                        surge_terms.append(PRIORITY_WEIGHT[ms.priority] * busy[(a.tail, d)])

    obj = 1000 * min_mc + 5 * sum(total_mc) - 4000 * sum(late.values())
    if mission_aware:
        obj -= 400 * sum(shortfall_terms) + 30 * sum(surge_terms)
    # Mild preference for doing predictive work later (uses more component life) only when nothing else differs.
    obj += sum(starts[v.id] for v in visits if v.fixed_start is None and not v.grounded_now)
    obj -= 3 * sum(starts[v.id] for v in visits if v.fixed_start is None and v.grounded_now)
    m.Maximize(obj)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_workers = 8
    solver.parameters.random_seed = 7
    status = solver.Solve(m)
    status_name = solver.StatusName(status)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {
            "status": status_name,
            "blocks": [],
            "bundling": bundle_summary,
            "solve_seconds": round(time.time() - t0, 2),
        }

    # Bay assignment: greedy interval colouring per base.
    blocks = []
    for base, vs in by_base.items():
        bay_ids = list(state.bays.get(base, [f"{base}-B1"]))
        free = {b: -1 for b in bay_ids}
        for v in sorted(vs, key=lambda v: solver.Value(starts[v.id])):
            s = solver.Value(starts[v.id])
            bay = next((b for b in bay_ids if free[b] <= s), min(bay_ids, key=lambda b: free[b]))
            free[bay] = s + v.duration
            if s >= H + 30:
                continue
            blocks.append(
                {
                    "tail": v.tail,
                    "base_id": base,
                    "bay_id": bay,
                    "start_day": s,
                    "duration_days": v.duration,
                    "bundled_count": len(v.bundled),
                    "locked": v.fixed_start is not None,
                    "late_days": solver.Value(late[v.id]) if v.id in late else 0,
                    "tasks": [{**_task_json(t), "bundled": t in v.bundled} for t in v.tasks]
                    or [
                        {
                            "id": v.id,
                            "title": "Scenario: scheduled inspection",
                            "source": "scenario",
                            "position": "Airframe",
                            "due_day": s,
                            "trade": "airframe",
                            "bundled": False,
                        }
                    ],
                }
            )
    return {
        "status": status_name,
        "objective": solver.ObjectiveValue(),
        "min_mc": solver.Value(min_mc),
        "solve_seconds": round(time.time() - t0, 2),
        "mission_aware": mission_aware,
        "bundling": bundle_summary,
        "late_visits": sum(1 for b in blocks if b["late_days"] > 0),
        "blocks": sorted(blocks, key=lambda b: (b["start_day"], b["base_id"])),
    }


def _task_json(t) -> dict:
    return {
        "id": t.id,
        "title": t.title,
        "source": t.source,
        "position": t.position,
        "kind": t.kind,
        "trade": t.trade,
        "due_day": t.due_day,
        "p10_day": t.p10_day,
        "p50_day": t.p50_day,
        "p90_day": t.p90_day,
        "duration": t.duration,
        "man_hours": t.man_hours,
        "part_number": t.part_number,
        "part_source": t.part_source,
        "earliest_day": t.earliest_day,
        "component_id": t.component_id,
    }
