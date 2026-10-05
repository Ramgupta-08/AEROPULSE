"""Opportunistic maintenance bundling.

When an aircraft has to go into a hangar within the planning horizon, other tasks on the same aircraft that
fall due within the bundling window are pulled into the same visit — provided their parts are available by
then and they fit the slot (different trades work in parallel; the visit may grow by at most one day).
Each bundled task is one grounding avoided.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from app.services.planning import HORIZON, Task

SEPARATE_VISIT_OVERHEAD = 1  # positioning, de-fuel, ground runs: one extra day for every separate grounding
MAX_GROWTH = 1  # a bundled task may extend the visit by at most this many days


@dataclass
class Visit:
    id: str
    tail: str
    base_id: str
    aircraft_type: str
    tasks: list[Task]
    anchor_ids: set[str]
    earliest: int
    due: int | None  # latest start before a P10 failure / life limit (None: work order, start asap)
    fixed_start: int | None = None
    grounded_now: bool = False
    bundled: list[Task] = field(default_factory=list)
    forced_duration: int | None = None  # scenario visits without tasks

    @property
    def duration(self) -> int:
        return self.forced_duration or visit_duration(self.tasks)

    def trade_load(self) -> dict[str, float]:
        load: dict[str, float] = defaultdict(float)
        for t in self.tasks:
            load[t.trade] += t.man_hours
        return dict(load)


def visit_duration(tasks: list[Task]) -> int:
    """Trades work in parallel; tasks of the same trade run back to back."""
    per_trade: dict[str, int] = defaultdict(int)
    for t in tasks:
        per_trade[t.trade] += t.duration
    return max(per_trade.values()) if per_trade else 1


def build_visits(
    tasks: list[Task], window: int = 20, horizon: int = HORIZON, bundling: bool = True
) -> tuple[list[Visit], dict]:
    by_tail: dict[str, list[Task]] = defaultdict(list)
    for t in tasks:
        by_tail[t.tail].append(t)
    visits: list[Visit] = []
    saved_groundings = 0
    saved_days = 0.0
    bundled_tasks = 0
    for tail, ts in sorted(by_tail.items()):
        anchors = [t for t in ts if t.source == "work-order" or t.due_day < horizon]
        if not anchors:
            continue
        others = sorted((t for t in ts if t not in anchors), key=lambda t: t.due_day)
        anchor_due = min(t.due_day for t in anchors)
        wo = next((t for t in anchors if t.source == "work-order"), None)
        if bundling:
            # Anchors due within the window of the earliest anchor share one visit; the rest get their own.
            groups = [[t for t in anchors if t.due_day <= anchor_due + window]]
            rest = [t for t in anchors if t not in groups[0]]
        else:
            groups = [[t] for t in sorted(anchors, key=lambda t: t.due_day)]
            rest = []
        for t in rest:
            groups.append([t])
        for gi, group in enumerate(groups):
            base_tasks = list(group)
            bundled: list[Task] = []
            if bundling:
                bundled = [t for t in group[1:] if t.source != "work-order"]  # anchors merged into the first slot
                if gi == 0:
                    for c in others:
                        if c.due_day > anchor_due + window:
                            continue
                        latest_start = min(t.due_day for t in base_tasks) if not wo else 0
                        if c.earliest_day > max(latest_start, max(t.earliest_day for t in base_tasks)):
                            continue  # its part would not be there in time
                        if visit_duration([*base_tasks, c]) > visit_duration(base_tasks) + MAX_GROWTH:
                            continue  # doesn't fit the slot
                        base_tasks.append(c)
                        bundled.append(c)
            first = base_tasks[0]
            in_work = any(t.in_work for t in base_tasks)
            v = Visit(
                id=f"V-{tail}-{gi}",
                tail=tail,
                base_id=first.base_id,
                aircraft_type=first.aircraft_type,
                tasks=base_tasks,
                anchor_ids={t.id for t in group},
                earliest=max(t.earliest_day for t in base_tasks),
                due=min((t.due_day for t in base_tasks if t.source != "work-order"), default=None),
                fixed_start=0 if in_work else None,
                grounded_now=any(t.source == "work-order" for t in base_tasks),
                bundled=bundled,
            )
            if bundled:
                standalone = sum(t.duration + SEPARATE_VISIT_OVERHEAD for t in bundled)
                growth = v.duration - visit_duration([t for t in base_tasks if t not in bundled])
                saved_groundings += len(bundled)
                saved_days += max(0, standalone - growth)
                bundled_tasks += len(bundled)
            visits.append(v)
    summary = {
        "window_days": window,
        "visits": len(visits),
        "bundled_tasks": bundled_tasks,
        "groundings_saved": saved_groundings,
        "downtime_avoided_hours": round(saved_days * 24),
    }
    return visits, summary
