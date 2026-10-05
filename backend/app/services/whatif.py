"""What-If simulator: apply scenario actions to a copy of today's planning state, re-optimise, compare."""

from __future__ import annotations

import copy
from dataclasses import replace
from datetime import timedelta

from sqlmodel import Session

from app.models import Mission
from app.services import planning as P
from app.services.scheduler import Constraints, optimise

ACTION_TYPES = {"send_for_maintenance", "delay_part", "add_mission", "lose_bays", "tech_shortage"}


def describe(a: dict) -> str:
    t = a["type"]
    if t == "send_for_maintenance":
        return f"Send {', '.join(a['tails'])} for maintenance on day {a['day']} ({a.get('duration', 3)} d)"
    if t == "delay_part":
        return f"Delay deliveries of {a['part_number']} by {a['days']} days"
    if t == "add_mission":
        return f"Add mission “{a['name']}”: {a['required']} × {a['aircraft_type']} at {a['base_id']} (days {a['start_day']}–{a['end_day']})"
    if t == "lose_bays":
        return f"Lose {a['count']} hangar bay(s) at {a['base_id']} for {a['days']} days from day {a['start_day']}"
    if t == "tech_shortage":
        return f"Technician shortage {a['pct']} %"
    return t


def apply(state: P.PlanState, actions: list[dict], mitigate: bool = True) -> tuple[P.PlanState, Constraints]:
    st = replace(state, tasks=copy.deepcopy(state.tasks), missions=list(state.missions))
    c = Constraints()
    for a in actions:
        t = a["type"]
        if t == "send_for_maintenance":
            for tail in a["tails"]:
                c.forced.append((tail, int(a["day"]), int(a.get("duration", 3))))
        elif t == "delay_part":
            for task in st.tasks:
                if task.part_number != a["part_number"] or task.part_source == "local stock":
                    continue
                if mitigate:
                    # Inter-base transfers are internal and unaffected; supplier deliveries slip.
                    if not task.part_source.startswith("transfer"):
                        task.earliest_day += int(a["days"])
                else:
                    task.earliest_day = task.order_day + int(a["days"])
                    task.part_source = f"supplier delivery (delayed {a['days']} d)"
                task.reactive_part_wait += int(a["days"])
        elif t == "add_mission":
            s = st.as_of + timedelta(days=int(a["start_day"]))
            e = st.as_of + timedelta(days=int(a["end_day"]))
            st.missions.append(
                Mission(
                    id=f"WI-{len(st.missions)}",
                    name=a["name"],
                    kind="exercise",
                    base_id=a["base_id"],
                    aircraft_type=a["aircraft_type"],
                    required_count=int(a["required"]),
                    start_date=s,
                    end_date=e,
                    priority=int(a.get("priority", 1)),
                    scope=a.get("scope", "base"),
                )
            )
        elif t == "lose_bays":
            c.bay_loss.append(
                (a["base_id"], int(a["start_day"]), int(a["start_day"]) + int(a["days"]), int(a["count"]))
            )
        elif t == "tech_shortage":
            c.tech_factor *= max(0.1, 1 - float(a["pct"]) / 100)
    return st, c


def _evaluate(st: P.PlanState, c: Constraints, mission_aware: bool) -> dict:
    res = optimise(st, mission_aware=mission_aware, constraints=c, time_limit=6)
    blocks = [{**b, "id": i} for i, b in enumerate(res["blocks"])]
    down = P.plan_downtime(st, blocks)
    sm = P.summarise(st, down)
    fc = P.forecast(st, blocks)["types"]
    return {
        "status": res["status"],
        "solve_seconds": res["solve_seconds"],
        "late_visits": res.get("late_visits", 0),
        "late": [
            {"tail": b["tail"], "late_days": b["late_days"], "tasks": [t["title"] for t in b["tasks"]]}
            for b in blocks
            if b.get("late_days")
        ],
        "summary": {k: v for k, v in sm.items() if k != "missions"},
        "missions": sm["missions"],
        "forecast": {
            k: {"p50": v["p50"], "low": v["low"], "high": v["high"], "demand": v["demand"], "total": v["total"]}
            for k, v in fc.items()
        },
        "blocks": len(blocks),
    }


def run(session: Session, actions: list[dict], mission_aware: bool = True) -> dict:
    base_state = P.load_state(session)
    baseline = _evaluate(base_state, Constraints(), mission_aware)
    st, c = apply(base_state, actions, mitigate=True)
    scenario = _evaluate(st, c, mission_aware)
    out = {
        "actions": [{**a, "label": describe(a)} for a in actions],
        "dates": [(base_state.as_of + timedelta(days=d)).isoformat() for d in range(P.HORIZON)],
        "baseline": baseline,
        "scenario": scenario,
        "delta": {
            "avg_readiness_pts": round(
                scenario["summary"]["avg_readiness_pct"] - baseline["summary"]["avg_readiness_pct"], 1
            ),
            "min_mc": scenario["summary"]["min_mc"] - baseline["summary"]["min_mc"],
            "downtime_aircraft_days": scenario["summary"]["downtime_aircraft_days"]
            - baseline["summary"]["downtime_aircraft_days"],
            "missions_short": scenario["summary"]["missions_short"] - baseline["summary"]["missions_short"],
            "late_visits": scenario["late_visits"] - baseline["late_visits"],
        },
        "mitigations": [],
    }
    delays = [a for a in actions if a["type"] == "delay_part"]
    if delays:
        st_u, c_u = apply(base_state, actions, mitigate=False)
        unmitigated = _evaluate(st_u, c_u, mission_aware)
        out["unmitigated"] = {k: unmitigated[k] for k in ("summary", "late", "late_visits", "missions")}
        pns = {a["part_number"] for a in delays}
        for tr in base_state.transfers:
            if tr["part_number"] in pns:
                out["mitigations"].append(
                    {
                        **tr,
                        "message": f"Transfer {tr['part_name']} {tr['from_name']} → {tr['to_name']} for {tr['tail']} "
                        f"({tr['transfer_days']} d instead of waiting for the delayed delivery)",
                    }
                )
    return out
