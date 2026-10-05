"""Logbook intelligence: themes from free-text defects, recurring-fault trends and automatically discovered insights.

Nothing here knows about the planted patterns — insights come from generic statistics:
- base × defect-type rate per aircraft vs the rest of the fleet (with seasonality),
- defect clustering by part batch (see spares.batch_watch),
- themes whose frequency is rising.
"""

from __future__ import annotations

import re
import threading
from collections import Counter, defaultdict
from datetime import date, timedelta

import numpy as np
from sklearn.cluster import KMeans
from sklearn.feature_extraction.text import TfidfVectorizer
from sqlmodel import Session, func, select

from app.models import Aircraft, Base, MaintenanceRecord, Part
from app.services import domain as D

STOP_EXTRA = [
    "carried",
    "found",
    "check",
    "checked",
    "replaced",
    "deg",
    "side",
    "kiya",
    "tha",
    "hua",
    "ke",
    "me",
    "se",
    "ho",
    "raha",
    "hai",
    "aa",
    "pe",
    "l",
    "h",
    "r",
    "ips",
    "mila",
    "bar",
    "time",
    "sortie",
    "after",
    "during",
    "engine",
    "system",
]
MONTHS_WINTER = {11, 12, 1, 2, 3}

_lock = threading.Lock()
_cache: dict[int, dict] = {}


def _defects(session: Session) -> list[MaintenanceRecord]:
    return list(session.exec(select(MaintenanceRecord).where(MaintenanceRecord.record_type == "defect")).all())


def themes(session: Session, k: int = 14) -> dict:
    n = session.exec(select(func.count()).select_from(MaintenanceRecord)).one()
    with _lock:
        if n in _cache:
            return _cache[n]
    recs = _defects(session)
    texts = [r.narrative for r in recs]
    from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS

    vec = TfidfVectorizer(
        stop_words=list(ENGLISH_STOP_WORDS.union(STOP_EXTRA)),
        token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z/]{2,}\b",
        ngram_range=(1, 2),
        min_df=3,
        sublinear_tf=True,
    )
    x = vec.fit_transform(texts)
    km = KMeans(n_clusters=k, n_init=10, random_state=0).fit(x)
    terms = np.array(vec.get_feature_names_out())
    as_of = max(r.date for r in recs)
    month_keys = [(as_of.year * 12 + as_of.month - 1 - i) for i in range(11, -1, -1)]
    out = []
    for c in range(k):
        idx = np.where(km.labels_ == c)[0]
        members = [recs[i] for i in idx]
        top = terms[np.argsort(-km.cluster_centers_[c])[:6]].tolist()
        kinds = Counter(m.component_kind for m in members)
        codes = Counter(m.defect_code for m in members)
        bases = Counter(m.base_id for m in members)
        monthly = Counter(m.date.year * 12 + m.date.month - 1 for m in members)
        recent = sum(1 for m in members if m.date > as_of - timedelta(days=90))
        prior = sum(1 for m in members if as_of - timedelta(days=180) < m.date <= as_of - timedelta(days=90))
        kind = kinds.most_common(1)[0][0]
        out.append(
            {
                "id": c,
                "label": f"{D.KIND_LABEL.get(kind, kind)} · {', '.join(top[:3])}",
                "top_terms": top,
                "size": len(members),
                "component_kind": kind,
                "defect_codes": codes.most_common(3),
                "bases": bases.most_common(3),
                "monthly": [monthly.get(m, 0) for m in month_keys],
                "recent_90d": recent,
                "prior_90d": prior,
                "examples": [
                    {"id": m.id, "tail": m.tail, "date": m.date.isoformat(), "narrative": m.narrative}
                    for m in members[:3]
                ],
            }
        )
    out.sort(key=lambda t: -t["size"])
    res = {
        "themes": out,
        "months": [date(m // 12, m % 12 + 1, 1).strftime("%b %y") for m in month_keys],
        "n_records": len(recs),
    }
    with _lock:
        _cache.clear()
        _cache[n] = res
    return res


def rate_insights(session: Session, min_events: int = 8, min_ratio: float = 2.5) -> list[dict]:
    """Defect types that are over-represented at a base (per aircraft), with seasonality when present."""
    recs = _defects(session)
    aircraft = session.exec(select(Aircraft)).all()
    per_base = Counter(a.base_id for a in aircraft)
    total = len(aircraft)
    bases = {b.id: b for b in session.exec(select(Base)).all()}
    by_code = defaultdict(list)
    for r in recs:
        by_code[r.defect_code].append(r)
    titles = {}
    from app.seed.logbook_text import DEFECTS

    for code, spec in DEFECTS.items():
        titles[code] = spec["title"]
    out = []
    for code, rs in by_code.items():
        cnt = Counter(r.base_id for r in rs)
        for base_id, n in cnt.items():
            if n < min_events:
                continue
            rate = n / per_base[base_id]
            rest = (len(rs) - n) / max(1, total - per_base[base_id])
            ratio = rate / max(rest, 1e-6)
            if ratio < min_ratio:
                continue
            winter = sum(1 for r in rs if r.base_id == base_id and r.date.month in MONTHS_WINTER) / n
            b = bases[base_id]
            season = f", {winter:.0%} of them in Nov–Mar" if winter >= 0.55 else ""
            out.append(
                {
                    "type": "base-rate",
                    "base_id": base_id,
                    "defect_code": code,
                    "events": n,
                    "ratio": round(ratio, 1),
                    "component_kind": rs[0].component_kind,
                    "environment": b.environment,
                    "title": f"{titles.get(code, code)} at {b.name}",
                    "message": f"{titles.get(code, code)} at {b.name} ({b.environment}) occur {ratio:.1f}× the rest-of-fleet rate per aircraft — {n} events in 24 months{season}.",
                    "recommendation": _recommend(code, b.environment),
                }
            )
    out.sort(key=lambda i: -i["ratio"])
    return out


def _recommend(code: str, env: str) -> str:
    if code.startswith("APU"):
        return "Adopt the cold-start procedure and battery pre-heat; stock APU igniter exciters at this base; apply the high-altitude wear factor."
    if code.endswith("COR"):
        return "Shorten the corrosion inspection interval, add fresh-water wash after sea-spray days and pre-position anti-corrosion kits."
    if code.startswith("ECS"):
        return "Increase ECS filter replacement frequency and stock dust filters locally."
    if code == "AV-MOI":
        return "Fit sealed connector kits and add desiccant checks during the monsoon."
    return f"Review the maintenance programme for {env} operations."


def insights(session: Session) -> list[dict]:
    from app.services import health as H
    from app.services.spares import batch_watch

    out = []
    for b in batch_watch(session, H.as_of(session)):
        if b["flagged"]:
            out.append(
                {
                    "type": "bad-batch",
                    "severity": "grounded",
                    "title": f"Bad batch {b['batch']}",
                    "message": b["insight"],
                    "batch": b["batch"],
                    "aircraft": b["aircraft"],
                    "bases": b["bases"],
                    "recommendation": "Quarantine remaining stock of this batch and replace on aircraft still carrying it.",
                }
            )
    for i in rate_insights(session):
        out.append({**i, "severity": "caution"})
    t = themes(session)
    for th in t["themes"]:
        if th["prior_90d"] >= 5 and th["recent_90d"] >= 1.6 * th["prior_90d"]:
            out.append(
                {
                    "type": "rising-theme",
                    "severity": "info",
                    "title": f"Rising: {th['label']}",
                    "message": f"Theme “{th['label']}” rose from {th['prior_90d']} to {th['recent_90d']} reports in the last 90 days.",
                    "recommendation": "Review recent rectifications for a common cause.",
                }
            )
    return out


# ---------------------------------------------------------------- voice / typed log entry structuring
KIND_WORDS = {
    "hydraulics": ["hydraulic", "hyd", "हाइड्रोलिक", "seal", "सील", "accumulator", "leak", "रिसाव"],
    "engine": ["engine", "इंजन", "egt", "vibration", "कंपन", "borescope", "oil press", "compressor", "fod"],
    "apu": ["apu", "auxiliary"],
    "landing_gear": ["gear", "tyre", "tire", "टायर", "brake", "ब्रेक", "strut", "wheel", "पहिया", "corrosion", "जंग"],
    "avionics": ["mfd", "display", "avionics", "ins ", "radio", "connector", "bite", "nav"],
    "fuel": ["fuel", "ईंधन", "boost pump", "tank"],
    "flight_controls": ["aileron", "elevator", "actuator", "flap", "rudder", "trim", "hinge"],
    "ecs": ["ecs", "cooling", "cockpit", "garam", "गर्म", "pack", "filter"],
}
ACTION_WORDS = {
    "replaced": ["replaced", "replace", "changed", "badla", "badal", "बदला", "बदल", "lagaya", "fitted", "installed"],
    "inspected": ["inspected", "checked", "check kiya", "जांच", "dekha"],
    "serviced": ["serviced", "topped", "bled", "cleaned", "saaf", "साफ"],
    "adjusted": ["adjusted", "rigged", "trimmed", "balanced"],
}
TAIL_RE = re.compile(r"\bAP[\s-]?(1[0-6]\d)\b", re.I)


def structure(session: Session, text: str, tail: str | None = None) -> dict:
    low = text.lower()
    m = TAIL_RE.search(text)
    tail = tail or (f"AP-{m.group(1)}" if m else None)
    kind_scores = {k: sum(low.count(w) for w in ws) for k, ws in KIND_WORDS.items()}
    kind = max(kind_scores, key=kind_scores.get) if max(kind_scores.values()) > 0 else None
    action = next((a for a, ws in ACTION_WORDS.items() if any(w in low for w in ws)), None)
    # Defect code: nearest past defect narrative of the same component kind.
    from app.services.retrieval import get_index

    idx = get_index(session)
    cases = idx.cases(text, k=8)
    code = None
    for c, _ in cases:
        if kind is None or c["component_kind"] == kind:
            code = c["defect_code"]
            kind = kind or c["component_kind"]
            break
    parts = []
    a = session.get(Aircraft, tail) if tail else None
    if kind and a:
        prefix = f"{D.TYPE_CODE[a.type]}-{D.KIND_CODE[kind]}-"
        cands = [
            p
            for p in session.exec(select(Part).where(Part.component_kind == kind)).all()
            if p.part_number.startswith(prefix)
        ]
        common = Counter(w for p in cands for w in set(p.name.lower().split()))
        for p in cands:
            specific = [w for w in p.name.lower().split() if len(w) > 3 and common[w] == 1]
            if any(w in low for w in specific):
                parts.append(p.part_number)
    side = (
        "L/H"
        if re.search(r"\b(left|l/h|baya|बाय)", low)
        else "R/H"
        if re.search(r"\b(right|r/h|daya|दाय)", low)
        else None
    )
    confidence = round(min(1.0, 0.25 * bool(tail) + 0.3 * bool(kind) + 0.25 * bool(code) + 0.2 * bool(action)), 2)
    return {
        "tail": tail,
        "component_kind": kind,
        "component_label": D.KIND_LABEL.get(kind) if kind else None,
        "defect_code": code,
        "action": action,
        "side": side,
        "parts_used": sorted(set(parts))[:3],
        "confidence": confidence,
        "narrative": text.strip(),
        "similar": [
            {"id": c["id"], "tail": c["tail"], "defect_code": c["defect_code"], "narrative": c["narrative"]}
            for c, _ in cases[:3]
        ],
    }
