"""Spares & logistics: RUL-driven demand, inventory status, cannibalisation advisor, bad-batch watch."""

from __future__ import annotations

import re
import statistics
from collections import defaultdict
from datetime import timedelta

from sqlmodel import Session, select

from app.models import CannibalisationAction, Component, MaintenanceRecord, Part, StockLevel, WorkOrder
from app.services import domain as D
from app.services import planning as P

HOURS_RE = re.compile(r"(\d{2,4})\s*(?:hrs|hours|ghante)", re.I)


def demand(state: P.PlanState) -> dict[tuple[str, str], list[dict]]:
    """Parts needed per (part, base): from open work orders, and from components predicted to fail
    (needed by the P10 point) or reaching life limits — i.e. parts needed before they fail."""
    out: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for t in state.tasks:
        if t.part_number:
            out[(t.part_number, t.base_id)].append(
                {"tail": t.tail, "need_day": max(0, t.due_day), "source": t.source, "task": t.title}
            )
    # Longer-range: components whose P50 failure falls within 60 days but outside the planning task list.
    seen = {(t.component_id) for t in state.tasks}
    for ah in state.fleet:
        for ch in ah.components:
            if ch.id in seen or ch.p50_days > 60:
                continue
            pn = D.task_part(ah.aircraft.type, ch.kind)
            out[(pn, ah.aircraft.base_id)].append(
                {
                    "tail": ah.aircraft.tail,
                    "need_day": max(0, int(ch.p10_days)),
                    "source": "predicted",
                    "task": ch.position,
                }
            )
    return out


def inventory(session: Session, state: P.PlanState, base_id: str | None = None) -> list[dict]:
    parts = {p.part_number: p for p in session.exec(select(Part)).all()}
    dem = demand(state)
    names = {ah.base.id: ah.base.name for ah in state.fleet}
    inbound = defaultdict(int)
    for t in state.transfers:
        inbound[(t["part_number"], t["to_base"])] += 1
    rows = []
    for sl in session.exec(select(StockLevel)).all():
        if base_id and sl.base_id != base_id:
            continue
        p = parts[sl.part_number]
        needs = sorted(dem.get((sl.part_number, sl.base_id), []), key=lambda d: d["need_day"])
        d30 = sum(1 for n in needs if n["need_day"] <= 30)
        d60 = len(needs)
        projected = sl.on_hand + (sl.on_order or 0) - d60
        covered = sl.on_hand + (sl.on_order if sl.order_eta and (sl.order_eta - state.as_of).days <= 30 else 0)
        if d30 > covered and d30 <= covered + inbound[(sl.part_number, sl.base_id)]:
            status = "transfer"
        elif d30 > covered:
            status = "shortfall"
        elif sl.on_hand - d30 < sl.reorder_point:
            status = "reorder"
        else:
            status = "ok"
        rows.append(
            {
                "part_number": sl.part_number,
                "name": p.name,
                "component_kind": p.component_kind,
                "base_id": sl.base_id,
                "base_name": names.get(sl.base_id, sl.base_id),
                "on_hand": sl.on_hand,
                "reorder_point": sl.reorder_point,
                "on_order": sl.on_order,
                "order_eta": sl.order_eta.isoformat() if sl.order_eta else None,
                "lead_time_days": p.lead_time_days,
                "unit_cost": p.unit_cost,
                "demand_30d": d30,
                "demand_60d": d60,
                "projected_balance": projected,
                "status": status,
                "needs": needs[:6],
                "first_need_day": needs[0]["need_day"] if needs else None,
            "inbound_transfers": inbound[(sl.part_number, sl.base_id)],
            }
        )
    order = {"shortfall": 0, "transfer": 1, "reorder": 2, "ok": 3}
    rows.sort(
        key=lambda r: (
            order[r["status"]],
            r["first_need_day"] if r["first_need_day"] is not None else 999,
            r["part_number"],
        )
    )
    return rows


def transfers(state: P.PlanState) -> list[dict]:
    out = []
    for t in state.transfers:
        need = "now" if t["need_day"] <= 0 else f"in {t['need_day']} days"
        out.append(
            {
                **t,
                "message": f"{t['from_name']} has {t['donor_on_hand']} spare {t['part_name']}{'s' if t['donor_on_hand'] != 1 else ''}, "
                f"{t['to_name']} needs 1 {need} for {t['tail']} — transfer instead of ordering (saves {t['days_saved']} days lead time)",
            }
        )
    return sorted(out, key=lambda t: (t["need_day"], -t["days_saved"]))


# ---------------------------------------------------------------- cannibalisation
MIN_WAIT = 7  # only consider robbing when the part is more than a week away
LONG_MAINTENANCE = 10  # donor must be on the ground at least this many more days


def cannibalisation(session: Session, state: P.PlanState) -> dict:
    wos = {w.tail: w for w in session.exec(select(WorkOrder)).all()}
    comps: dict[str, list[Component]] = defaultdict(list)
    for c in session.exec(select(Component)).all():
        comps[c.tail].append(c)
    suggestions = []
    for t in state.tasks:
        if t.source != "work-order" or t.status != "awaiting-part" or not t.part_number or t.earliest_day <= MIN_WAIT:
            continue
        recipient = state.aircraft_index[t.tail]
        kind = next((k for k in D.KINDS if D.KIND_CODE[k] == t.part_number.split("-")[1]), None)
        for tail, wo in wos.items():
            donor = state.aircraft_index.get(tail)
            if donor is None or tail == t.tail or donor.aircraft.type != recipient.aircraft.type:
                continue
            if wo.remaining_days < LONG_MAINTENANCE or wo.status == "awaiting-part":
                continue
            cands = [c for c in comps[tail] if c.kind == kind and not c.robbed]
            if not cands:
                continue
            donor_health = {ch.id: ch for ch in donor.components}
            best = max(cands, key=lambda c: donor_health[c.id].health if c.id in donor_health else 0)
            h = donor_health.get(best.id)
            if h is None or h.health < 50:
                continue
            _, dur, mh = D.TASK_SPEC[kind]
            recipient_back_rob = 1 + t.duration
            recipient_back_wait = t.earliest_day + t.duration
            donor_back_now = wo.remaining_days
            donor_back_after = max(
                wo.remaining_days, t.earliest_day + dur
            )  # replacement part has to arrive for the donor
            H = P.HORIZON
            gain = min(recipient_back_wait, H) - min(recipient_back_rob, H)
            loss = min(donor_back_after, H) - min(donor_back_now, H)
            suggestions.append(
                {
                    "recipient": t.tail,
                    "recipient_base": recipient.aircraft.base_id,
                    "donor": tail,
                    "donor_base": donor.aircraft.base_id,
                    "part_number": t.part_number,
                    "part_name": next(
                        (p.name for p in session.exec(select(Part).where(Part.part_number == t.part_number)).all()),
                        t.part_number,
                    ),
                    "component_id": best.id,
                    "component": best.position,
                    "serial": best.serial,
                    "donor_component_health": h.health,
                    "recipient_wait_days": t.earliest_day,
                    "recipient_back_day_rob": recipient_back_rob,
                    "recipient_back_day_wait": recipient_back_wait,
                    "donor_back_day_before": donor_back_now,
                    "donor_back_day_after": donor_back_after,
                    "readiness_gain_aircraft_days": gain - loss,
                    "extra_man_hours": round(mh * 0.75),
                    "donor_reason": wo.title,
                    "message": f"Rob {best.position.lower()} (S/N {best.serial}) from {tail} — already in long maintenance ({wo.title.lower()}) — "
                    f"to return {t.tail} to service on day {recipient_back_rob} instead of day {recipient_back_wait}.",
                }
            )
    suggestions.sort(key=lambda s: -s["readiness_gain_aircraft_days"])
    tracked = [
        {
            "id": a.id,
            "donor": a.donor_tail,
            "recipient": a.recipient_tail,
            "part_number": a.part_number,
            "serial": a.serial,
            "status": a.status,
            "approved_by": a.approved_by,
            "created_at": a.created_at.isoformat(),
            "replacement_eta": a.replacement_eta.isoformat() if a.replacement_eta else None,
        }
        for a in session.exec(select(CannibalisationAction).order_by(CannibalisationAction.created_at.desc())).all()  # type: ignore[union-attr]
    ]
    done = {(a["donor"], a["recipient"]) for a in tracked}
    return {"suggestions": [s for s in suggestions if (s["donor"], s["recipient"]) not in done], "tracked": tracked}


def approve_cannibalisation(session: Session, state: P.PlanState, recipient: str, donor: str) -> CannibalisationAction:
    adv = cannibalisation(session, state)
    s = next((x for x in adv["suggestions"] if x["recipient"] == recipient and x["donor"] == donor), None)
    if s is None:
        raise ValueError("No such cannibalisation suggestion")
    comp = session.get(Component, s["component_id"])
    comp.robbed = True
    rwo = session.exec(select(WorkOrder).where(WorkOrder.tail == recipient)).one()
    dwo = session.exec(select(WorkOrder).where(WorkOrder.tail == donor)).one()
    rwo.status, rwo.part_number = "in-work", None
    rwo.title = f"{rwo.title} — part robbed from {donor}"
    rwo.remaining_days = s["recipient_back_day_rob"]
    dwo.remaining_days = s["donor_back_day_after"]
    dwo.title = f"{dwo.title} + awaiting replacement {comp.position.lower()}"
    act = CannibalisationAction(
        donor_tail=donor,
        recipient_tail=recipient,
        part_number=s["part_number"],
        serial=s["serial"],
        status="approved",
        approved_by="",
        replacement_eta=state.as_of + timedelta(days=s["recipient_wait_days"]),
    )
    session.add_all([comp, rwo, dwo, act])
    return act


# ---------------------------------------------------------------- batch watch
def batch_watch(session: Session, as_of, window_days: int = 90) -> list[dict]:
    recs = session.exec(
        select(MaintenanceRecord).where(MaintenanceRecord.batch.is_not(None), MaintenanceRecord.record_type == "defect")
    ).all()  # type: ignore[union-attr]
    comps = session.exec(select(Component).where(Component.kind == "hydraulics")).all()
    installed = defaultdict(list)
    for c in comps:
        installed[c.batch].append(c)
    by_batch: dict[str, list[MaintenanceRecord]] = defaultdict(list)
    for r in recs:
        by_batch[r.batch].append(r)
    since = as_of - timedelta(days=window_days)
    hours_all = []
    stats = []
    for batch, rs in by_batch.items():
        recent = [r for r in rs if r.date >= since]
        hrs = [int(m.group(1)) for r in rs if (m := HOURS_RE.search(r.action_taken + " " + r.narrative))]
        hours_all.extend(hrs)
        stats.append((batch, rs, recent, hrs))
    recent_counts = [len(x[2]) for x in stats]
    baseline = max(0.5, statistics.mean(recent_counts)) if recent_counts else 1
    fleet_median_hours = statistics.median(hours_all) if hours_all else None
    out = []
    for batch, rs, recent, hrs in stats:
        tails = sorted({r.tail for r in recent})
        bases = sorted({r.base_id for r in recent})
        ratio = len(recent) / baseline
        med = statistics.median(hrs) if hrs else None
        early = med is not None and fleet_median_hours is not None and med < 0.25 * fleet_median_hours
        flagged = len(tails) >= 3 and (ratio >= 3 or early)
        at_risk = [{"tail": c.tail, "position": c.position, "serial": c.serial} for c in installed.get(batch, [])]
        supplier = next((c.supplier for c in installed.get(batch, [])), None)
        out.append(
            {
                "batch": batch,
                "supplier": supplier,
                "failures_total": len(rs),
                "failures_window": len(recent),
                "window_days": window_days,
                "aircraft": tails,
                "bases": bases,
                "ratio_vs_fleet": round(ratio, 1),
                "median_hours_at_failure": med,
                "fleet_median_hours": fleet_median_hours,
                "flagged": flagged,
                "installed_at_risk": at_risk,
                "first": min(r.date for r in recent).isoformat() if recent else None,
                "last": max(r.date for r in recent).isoformat() if recent else None,
                "insight": (
                    f"Hydraulic seal batch {batch} failed on {len(tails)} aircraft at {len(bases)} bases in {window_days} days"
                    f"{f' after a median {med:.0f} h (fleet {fleet_median_hours:.0f} h)' if med and fleet_median_hours else ''} — likely bad batch. "
                    f"Quarantine stock and replace on {len(at_risk)} aircraft still carrying it."
                )
                if flagged
                else None,
            }
        )
    out.sort(key=lambda b: (not b["flagged"], -b["failures_window"]))
    return out
