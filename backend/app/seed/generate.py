"""Deterministic simulated fleet generator.

Usage:  python -m app.seed.generate
Creates data/aeropulse.db with 8 bases, 60 aircraft, their components (engines driven by NASA C-MAPSS
test trajectories), 24 months of technical records with planted patterns, spares, agencies, missions,
resources, users and the initial SHA-256 hash chain.

All data is SIMULATED. Tail numbers and aircraft types are fictional.
"""

from __future__ import annotations

import logging
import os
import random
from datetime import UTC, date, datetime, time, timedelta

import numpy as np
from sqlmodel import Session, SQLModel

from app.core.auth import DEMO_USERS, Role
from app.core.config import settings
from app.core.db import get_engine
from app.ml import cmapss
from app.ml.features import build_features, predict_quantiles
from app.models import (
    Agency,
    AgencyJob,
    Aircraft,
    Base,
    Component,
    HangarBay,
    MaintenanceRecord,
    Meta,
    Mission,
    Part,
    Squadron,
    StockLevel,
    TechnicianShift,
    User,
    WorkOrder,
)
from app.seed import logbook_text as T
from app.services import domain as D
from app.services.hashchain import Chain, record_payload
from app.services.rul import bundle

log = logging.getLogger("seed")

HISTORY_DAYS = 730
BAD_BATCH = "HS-2291"
BAD_BATCH_SUPPLIER = "Hydrotek Seals (fictional)"

# ---------------------------------------------------------------- fleet layout
# (base, type, count, squadron name, sortie profile)
LAYOUT = [
    ("JDH", D.FIGHTER, 6, "Squadron Shikra", "air-defence"),
    ("GWL", D.FIGHTER, 8, "Squadron Kestrel", "air-defence"),
    ("PNQ", D.FIGHTER, 6, "Squadron Merlin", "high-g-training"),
    ("TEZ", D.FIGHTER, 6, "Squadron Hornbill", "air-defence"),
    ("IXL", D.FIGHTER, 4, "Squadron Lammergeier", "air-defence"),
    ("JGA", D.FIGHTER, 6, "Squadron Osprey", "air-defence"),
    ("HDN", D.TRANSPORT, 6, "Squadron Pelican", "transport"),
    ("IXL", D.TRANSPORT, 2, "Squadron Condor", "transport"),
    ("TEZ", D.TRANSPORT, 2, "Squadron Stork", "transport"),
    ("BLR", D.TRANSPORT, 2, "Squadron Heron", "transport"),
    ("BLR", D.TRAINER, 6, "Training Flight Swift", "basic-training"),
    ("GWL", D.TRAINER, 2, "Training Flight Myna", "basic-training"),
    ("PNQ", D.TRAINER, 2, "Training Flight Bulbul", "basic-training"),
    ("HDN", D.TRAINER, 2, "Training Flight Kite", "basic-training"),
]

SUPPLIERS = {
    "engine": ["Turbomach Industries", "Aero Engines Corp"],
    "apu": ["Auxiliary Power Systems", "Turbomach Industries"],
    "landing_gear": ["Gearworks Ltd", "Precision Struts"],
    "hydraulics": ["Fluidline Systems", "Hydropower Components", BAD_BATCH_SUPPLIER],
    "avionics": ["Avionix Labs", "Navcom Systems"],
    "fuel": ["Fuel Dynamics", "Fluidline Systems"],
    "flight_controls": ["Actuation Systems", "Precision Struts"],
    "ecs": ["Climatech Aero", "Auxiliary Power Systems"],
}

# Aircraft currently on the ground with an open work order.
# tail, component kind, title, kind, status, remaining days, part suffix needed, opened days ago
GROUNDED = [
    ("AP-110", "hydraulics", "AOG — hydraulic pump failure after seal leak", "aog", "awaiting-part", 3, "01", 4),
    ("AP-104", "landing_gear", "Phase inspection", "phase-inspection", "in-work", 4, None, 3),
    ("AP-117", "engine", "Engine 1 change — compressor stall", "engine-change", "awaiting-part", 4, "01", 6),
    ("AP-122", "avionics", "Mission computer fault rectification", "defect", "in-work", 2, None, 2),
    ("AP-128", "apu", "AOG — APU starter-generator failed (cold start)", "aog", "awaiting-part", 2, "01", 3),
    ("AP-133", "landing_gear", "Corrosion treatment & main gear overhaul", "corrosion", "in-work", 26, None, 10),
    ("AP-131", "flight_controls", "Flap hinge corrosion rectification", "corrosion", "in-work", 5, None, 2),
    ("AP-107", "engine", "Engine hot-section inspection", "phase-inspection", "awaiting-slot", 3, None, 1),
    ("AP-138", "engine", "Engine 3 HPT blade damage (borescope finding)", "defect", "awaiting-part", 4, "02", 5),
    ("AP-143", "apu", "APU hung start rectification", "defect", "in-work", 2, None, 1),
    ("AP-146", "avionics", "Nav bay moisture ingress", "defect", "in-work", 3, None, 2),
    ("AP-140", "landing_gear", "Phase inspection", "phase-inspection", "in-work", 6, None, 2),
    ("AP-150", "landing_gear", "AOG — main gear shock strut leak", "aog", "awaiting-part", 2, "01", 3),
    ("AP-152", "landing_gear", "Phase inspection", "phase-inspection", "in-work", 3, None, 4),
    ("AP-157", "flight_controls", "Elevator actuator fault", "defect", "in-work", 2, None, 1),
    ("AP-160", "fuel", "Fuel boost pump failure", "defect", "awaiting-part", 2, "01", 2),
]

# Planted bad seal batch: installed on 8 aircraft at 3 bases; 6 already failed early, 2 still flying.
HS_FAILED = ["AP-109", "AP-110", "AP-102", "AP-104", "AP-122", "AP-124"]
HS_AT_RISK = {"AP-112": 15.0, "AP-125": 21.0}  # days of predicted hydraulic life remaining

# Near-term (non-engine) predicted failures and life-limit items: tail -> (kind, days to failure)
NEAR_TERM = {
    "AP-101": ("landing_gear", 9),
    "AP-114": ("ecs", 6),
    "AP-119": ("flight_controls", 11),
    "AP-127": ("apu", 8),
    "AP-135": ("landing_gear", 13),
    "AP-121": ("avionics", 24),
    "AP-139": ("apu", 17),
    "AP-142": ("landing_gear", 22),
    "AP-149": ("landing_gear", 10),
    "AP-154": ("flight_controls", 19),
    "AP-158": ("ecs", 27),
    "AP-106": ("fuel", 33),
    "AP-130": ("hydraulics", 38),
}
LIFE_LIMIT_DUE = {
    "AP-112": ("landing_gear", 16),
    "AP-115": ("ecs", 12),
    "AP-136": ("avionics", 21),
    "AP-144": ("fuel", 25),
}

# Engines with near-term predicted RUL (sorties, approx) besides AP-112 E2.
ENGINE_NEAR = {
    ("AP-112", 2): 18,
    ("AP-103", 1): 30,
    ("AP-120", 2): 34,
    ("AP-126", 1): 40,
    ("AP-141", 3): 36,
    ("AP-153", 1): 28,
}
ENGINE_ANOMALY = {
    ("AP-119", 1): {
        "s7": {"kind": "drift", "sigma": -5.5, "cycles": 18},
        "s12": {"kind": "drift", "sigma": -4.0, "cycles": 18},
    },
    ("AP-139", 3): {
        "s9": {"kind": "noise", "sigma": 5.0, "cycles": 15},
        "s14": {"kind": "noise", "sigma": 4.5, "cycles": 15},
    },
}
SORTIE_RATE_OVERRIDE = {"AP-112": 1.1}

AGENCIES = [
    # id, name, kind, location, promised TAT, capacity, specialities, tat factor, repeat-failure prob
    ("BRD-N", "Base Repair Depot – North", "depot", "Chandigarh", 30, 14, "engine,hydraulics,landing_gear", 1.38, 0.06),
    ("BRD-S", "Base Repair Depot – South", "depot", "Bengaluru", 28, 12, "engine,apu,fuel", 1.05, 0.05),
    ("OEM-A", "OEM Service Centre A", "oem", "Bengaluru", 21, 8, "engine,apu", 0.95, 0.03),
    ("OEM-B", "OEM Service Centre B", "oem", "Hyderabad", 25, 8, "avionics,flight_controls", 1.12, 0.04),
    ("ARF-E", "Avionics Repair Facility – East", "depot", "Kolkata", 18, 10, "avionics,ecs", 1.0, 0.07),
    (
        "FMU-W",
        "Field Maintenance Unit – West",
        "field",
        "Jodhpur",
        12,
        6,
        "landing_gear,hydraulics,ecs,fuel,flight_controls",
        0.9,
        0.17,
    ),
]

MISSIONS = [
    # name, kind, base, type, required, start day, end day, priority, scope
    ("Exercise Garuda Shield", "exercise", "GWL", D.FIGHTER, 30, 12, 15, 1, "fleet"),
    ("Operation Sahayata airlift", "transport", "HDN", D.TRANSPORT, 4, 5, 8, 1, "base"),
    ("Air defence alert — Pune", "surge", "PNQ", D.FIGHTER, 1, 0, 59, 1, "base"),
    ("Air defence alert — Tezpur", "surge", "TEZ", D.FIGHTER, 1, 0, 59, 1, "base"),
    ("Basic Flying Course — week 1", "training", "BLR", D.TRAINER, 4, 0, 6, 2, "base"),
    ("Basic Flying Course — week 2", "training", "BLR", D.TRAINER, 4, 7, 13, 2, "base"),
    ("Basic Flying Course — week 3", "training", "BLR", D.TRAINER, 4, 14, 20, 2, "base"),
    ("Basic Flying Course — week 4", "training", "BLR", D.TRAINER, 4, 21, 27, 2, "base"),
    ("Night flying package", "training", "GWL", D.FIGHTER, 4, 8, 10, 2, "base"),
    ("VIP airlift standby", "transport", "HDN", D.TRANSPORT, 2, 10, 12, 2, "base"),
    ("Instrument rating checks", "training", "PNQ", D.TRAINER, 2, 15, 16, 3, "base"),
    ("Para-drop training", "training", "HDN", D.TRANSPORT, 3, 18, 20, 2, "base"),
    ("Exercise Desert Lance", "exercise", "JDH", D.FIGHTER, 4, 20, 23, 2, "base"),
    ("Casualty evacuation exercise", "exercise", "TEZ", D.TRANSPORT, 1, 22, 23, 3, "base"),
    ("Exercise Coastal Sentinel", "exercise", "JGA", D.FIGHTER, 4, 25, 27, 2, "base"),
    ("Logistics airlift to Leh", "transport", "HDN", D.TRANSPORT, 3, 26, 28, 2, "base"),
    ("Trainer navigation exercise", "training", "GWL", D.TRAINER, 2, 28, 29, 3, "base"),
    ("Exercise Eastern Sentinel", "exercise", "TEZ", D.FIGHTER, 4, 30, 33, 2, "base"),
    ("High-altitude landing trials", "exercise", "IXL", D.TRANSPORT, 1, 33, 35, 2, "base"),
    ("Formation display rehearsal", "training", "BLR", D.TRAINER, 5, 35, 37, 2, "base"),
    ("Exercise Himalayan Vigil", "exercise", "IXL", D.FIGHTER, 3, 40, 44, 1, "base"),
    ("Exercise Iron Monsoon", "exercise", "TEZ", D.FIGHTER, 4, 45, 48, 2, "base"),
    ("Exercise Sky Lattice", "exercise", "GWL", D.FIGHTER, 5, 50, 53, 2, "base"),
    ("Exercise Thar Strike", "exercise", "JDH", D.FIGHTER, 4, 55, 58, 2, "base"),
    ("Exercise Southern Arc", "exercise", "BLR", D.TRAINER, 4, 52, 54, 3, "base"),
]

TECHNICIANS = {"engine": 6, "airframe": 8, "avionics": 4}


def _as_of() -> date:
    env = os.getenv("AEROPULSE_AS_OF")
    return date.fromisoformat(env) if env else date.today()


class Generator:
    def __init__(self, session: Session, as_of: date, seed: int):
        self.s = session
        self.as_of = as_of
        self.rng = np.random.default_rng(seed)
        self.py = random.Random(seed)
        self.aircraft: dict[str, Aircraft] = {}
        self.components: dict[str, list[Component]] = {}
        self.bases: dict[str, Base] = {}
        self.records: list[MaintenanceRecord] = []
        self.serial_n = 10000

    # ------------------------------------------------------------ helpers
    def d(self, offset: int) -> date:
        return self.as_of + timedelta(days=int(offset))

    def serial(self, prefix: str) -> str:
        self.serial_n += int(self.rng.integers(1, 9))
        return f"{prefix}-{self.serial_n}"

    def batch(self, kind: str) -> str:
        code = {
            "hydraulics": "HS",
            "engine": "EN",
            "apu": "AP",
            "landing_gear": "LG",
            "avionics": "AV",
            "fuel": "FU",
            "flight_controls": "FC",
            "ecs": "EC",
        }[kind]
        if kind == "hydraulics":
            return f"HS-{self.py.choice([2281, 2283, 2284, 2286, 2288, 2290, 2293, 2295])}"
        return f"{code}-{int(self.rng.integers(1100, 1990))}"

    # ------------------------------------------------------------ static data
    def make_bases(self) -> None:
        for bid, name, lat, lon, env, bays in D.BASES:
            b = Base(id=bid, name=name, lat=lat, lon=lon, environment=env, hangar_bays=bays)
            self.bases[bid] = b
            self.s.add(b)
            self.s.flush()
            for i in range(bays):
                self.s.add(HangarBay(id=f"{bid}-B{i + 1}", base_id=bid, name=f"{name} Bay {i + 1}"))
            for trade, n in TECHNICIANS.items():
                self.s.add(
                    TechnicianShift(base_id=bid, trade=trade, technicians=n + (2 if bays >= 3 else 0), hours_per_day=8)
                )

    def make_parts(self) -> None:
        bases_by_type: dict[str, set[str]] = {}
        for base, typ, *_ in LAYOUT:
            bases_by_type.setdefault(typ, set()).add(base)
        for typ in D.TYPES:
            for kind in D.KINDS:
                for suffix, name, cost, lead, repairable in D.PART_TEMPLATES[kind]:
                    pn = D.part_number(typ, kind, suffix)
                    self.s.add(
                        Part(
                            part_number=pn,
                            name=f"{name}",
                            component_kind=kind,
                            unit_cost=round(cost * (1.6 if typ == D.TRANSPORT else 1.0), 2),
                            lead_time_days=lead,
                            supplier=self.py.choice(SUPPLIERS[kind][:2]),
                            repairable=repairable,
                        )
                    )
                    for base in sorted(bases_by_type[typ]):
                        consumable = not repairable
                        on_hand = int(self.rng.integers(2, 9)) if consumable else int(self.rng.integers(0, 3))
                        rop = 3 if consumable else 1
                        self.s.add(StockLevel(part_number=pn, base_id=base, on_hand=on_hand, reorder_point=rop))
        self.s.flush()
        # Planted stock situations that drive transfer / cannibalisation stories.
        self.set_stock(
            D.part_number(D.FIGHTER, "hydraulics", "01"), {"GWL": 0, "JDH": 3, "PNQ": 1, "TEZ": 0, "IXL": 0, "JGA": 1}
        )
        self.set_stock(
            D.part_number(D.FIGHTER, "hydraulics", "02"), {"GWL": 1, "JDH": 6, "PNQ": 4, "TEZ": 0, "IXL": 3, "JGA": 4}
        )
        self.set_stock(
            D.part_number(D.FIGHTER, "engine", "01"), {"GWL": 1, "JDH": 0, "PNQ": 0, "TEZ": 0, "IXL": 0, "JGA": 0}
        )
        self.set_stock(
            D.part_number(D.FIGHTER, "apu", "01"), {"GWL": 1, "JDH": 0, "PNQ": 2, "TEZ": 0, "IXL": 0, "JGA": 0}
        )
        self.set_stock(D.part_number(D.TRANSPORT, "engine", "02"), {"HDN": 0, "IXL": 0, "TEZ": 0, "BLR": 1})
        self.set_stock(D.part_number(D.TRAINER, "landing_gear", "01"), {"BLR": 0, "GWL": 1, "PNQ": 0, "HDN": 1})
        self.set_stock(D.part_number(D.TRAINER, "fuel", "01"), {"BLR": 1, "GWL": 0, "PNQ": 1, "HDN": 0})
        self.set_stock(
            D.part_number(D.FIGHTER, "landing_gear", "02"), {"GWL": 2, "JDH": 0, "PNQ": 2, "TEZ": 1, "IXL": 1, "JGA": 0}
        )
        self.set_stock(
            D.part_number(D.FIGHTER, "ecs", "01"), {"GWL": 1, "JDH": 0, "PNQ": 1, "TEZ": 1, "IXL": 1, "JGA": 1}
        )
        self.set_stock(
            D.part_number(D.FIGHTER, "flight_controls", "01"),
            {"GWL": 1, "JDH": 1, "PNQ": 0, "TEZ": 1, "IXL": 0, "JGA": 1},
        )
        # Some parts already on order.
        sl = self.s.get(StockLevel, self._stock_id(D.part_number(D.FIGHTER, "hydraulics", "02"), "TEZ"))
        sl.on_order, sl.order_eta = 10, self.d(9)

    def _stock_id(self, pn: str, base: str) -> int:
        from sqlmodel import select

        return self.s.exec(select(StockLevel.id).where(StockLevel.part_number == pn, StockLevel.base_id == base)).one()

    def set_stock(self, pn: str, levels: dict[str, int]) -> None:
        for base, n in levels.items():
            self.s.get(StockLevel, self._stock_id(pn, base)).on_hand = n

    def make_agencies(self) -> None:
        for aid, name, kind, loc, tat, cap, spec, *_ in AGENCIES:
            self.s.add(
                Agency(
                    id=aid, name=name, kind=kind, location=loc, promised_tat_days=tat, capacity=cap, specialities=spec
                )
            )

    # ------------------------------------------------------------ fleet
    def make_fleet(self) -> None:
        n = 101
        sq_i = 0
        for base, typ, count, sq_name, profile in LAYOUT:
            sq_i += 1
            sq = Squadron(id=f"SQ{sq_i:02d}", name=sq_name, base_id=base, aircraft_type=typ)
            self.s.add(sq)
            self.s.flush()
            for _ in range(count):
                tail = f"AP-{n}"
                n += 1
                spec = D.TYPES[typ]
                spd = SORTIE_RATE_OVERRIDE.get(
                    tail, round(spec["sorties_per_day"] * float(self.rng.uniform(0.85, 1.15)), 2)
                )
                entered = self.d(-int(self.rng.integers(5 * 365, 16 * 365)))
                years = (self.as_of - entered).days / 365
                cycles = int(years * 365 * spec["sorties_per_day"] * 0.92)
                a = Aircraft(
                    tail=tail,
                    type=typ,
                    base_id=base,
                    squadron_id=sq.id,
                    sortie_profile=profile,
                    total_cycles=cycles,
                    total_hours=round(cycles * spec["hours_per_sortie"], 1),
                    entered_service=entered,
                    sorties_per_day=spd,
                )
                self.aircraft[tail] = a
                self.s.add(a)
        self.s.flush()

    def _engine_pool(self) -> list[dict]:
        """Predict RUL at the last observed cycle of every test engine (FD001 + FD003)."""
        pool = []
        for ds in ("FD001", "FD003"):
            b = bundle(ds)
            test = cmapss.load(ds, "test")
            feats = build_features(b["pre"].normalise(test), b["pre"].sensors)
            last = feats.groupby("unit").tail(1)
            p = predict_quantiles(b["models"], last[b["columns"]], b.get("cqr", 0.0))
            truth = cmapss.load_rul(ds)
            for i, (unit, cyc) in enumerate(zip(last["unit"], last["cycle"], strict=True)):
                pool.append(
                    {
                        "ds": ds,
                        "unit": int(unit),
                        "cycle": int(cyc),
                        "p10": p[0][i],
                        "p50": p[1][i],
                        "p90": p[2][i],
                        "true": int(truth[int(unit) - 1]),
                    }
                )
        return pool

    def make_components(self) -> None:
        pool = self._engine_pool()
        used: set[tuple[str, int]] = set()

        def take(pred) -> dict:
            cands = [e for e in pool if (e["ds"], e["unit"]) not in used and pred(e)]
            e = cands[0] if cands else next(e for e in pool if (e["ds"], e["unit"]) not in used)
            used.add((e["ds"], e["unit"]))
            return e

        # AP-112 Engine 2: P50 ≈ 18 sorties with a tight interval, and truth consistent with the prediction.
        ap112 = sorted(
            (e for e in pool if 10 <= e["p10"] and e["p90"] <= 30 and abs(e["true"] - e["p50"]) <= 6),
            key=lambda e: abs(e["p50"] - 18) + 0.3 * abs(e["p90"] - e["p10"] - 9),
        )[0]
        used.add((ap112["ds"], ap112["unit"]))
        near_sorted = {k: v for k, v in ENGINE_NEAR.items() if k != ("AP-112", 2)}
        healthy = [e for e in pool if e["p50"] >= 60 and e["p10"] >= 35]
        self.py.shuffle(healthy)
        hi = 0

        for tail, a in self.aircraft.items():
            comps: list[Component] = []
            spec = D.TYPES[a.type]
            for k in range(1, spec["engines"] + 1):
                if (tail, k) == ("AP-112", 2):
                    e = ap112
                elif (tail, k) in near_sorted:
                    target = near_sorted[(tail, k)]
                    e = take(lambda e, t=target: abs(e["p50"] - t) <= 6 and e["p90"] - e["p10"] <= 30)
                else:
                    while hi < len(healthy) and (healthy[hi]["ds"], healthy[hi]["unit"]) in used:
                        hi += 1
                    e = healthy[hi] if hi < len(healthy) else take(lambda e: e["p50"] >= 45)
                    used.add((e["ds"], e["unit"]))
                    hi += 1
                lim_h, lim_c, lim_d = D.LIFE_LIMITS["engine"]
                installed = self.d(-int(e["cycle"] / a.sorties_per_day))
                comps.append(
                    Component(
                        tail=tail,
                        kind="engine",
                        position=f"Engine {k}",
                        part_number=D.part_number(a.type, "engine", "01"),
                        serial=self.serial("ENG"),
                        batch=self.batch("engine"),
                        supplier=self.py.choice(SUPPLIERS["engine"]),
                        installed_on=installed,
                        cycles_since_install=e["cycle"],
                        hours_since_install=round(e["cycle"] * spec["hours_per_sortie"], 1),
                        life_limit_hours=lim_h,
                        life_limit_cycles=lim_c,
                        life_limit_days=lim_d,
                        condition=round(min(100, e["p50"] / 125 * 100), 1),
                        wear_per_day=0,
                        cmapss_dataset=e["ds"],
                        cmapss_unit=e["unit"],
                        cmapss_cycle=e["cycle"],
                        cmapss_split="test",
                        telemetry_injection=ENGINE_ANOMALY.get((tail, k)),
                    )
                )
            for kind in D.KINDS[1:]:
                comps.append(self._component(a, kind))
            self.components[tail] = comps
            for c in comps:
                self.s.add(c)
        self.s.flush()
        self.engine_ap112 = ap112

    def _component(self, a: Aircraft, kind: str) -> Component:
        spec = D.TYPES[a.type]
        lim_h, lim_c, lim_d = D.LIFE_LIMITS[kind]
        env = self.bases[a.base_id].environment
        m_env, m_prof = D.wear_multiplier(kind, env, a.sortie_profile)
        wear = round(D.KIND_WEAR[kind] * float(self.rng.uniform(0.8, 1.2)), 4)
        eff = wear * m_env * m_prof
        # Typical healthy component: 90-600 days of predicted life left.
        days_left = float(self.rng.uniform(90, 600))
        batch = self.batch(kind)
        supplier = self.py.choice(SUPPLIERS[kind][:2])
        if a.tail in NEAR_TERM and NEAR_TERM[a.tail][0] == kind:
            days_left = NEAR_TERM[a.tail][1]
        if kind == "hydraulics" and a.tail in HS_AT_RISK:
            days_left, batch, supplier = HS_AT_RISK[a.tail], BAD_BATCH, BAD_BATCH_SUPPLIER
        condition = min(99.0, D.FAILURE_THRESHOLD + days_left * eff)
        # Effective life in days is bounded by whichever limit (hours, cycles, calendar) is reached first.
        life_days = min(lim_h / (a.sorties_per_day * spec["hours_per_sortie"]), lim_c / a.sorties_per_day, lim_d)
        age_days = int(self.rng.uniform(0.1, 0.8) * life_days)
        if a.tail in LIFE_LIMIT_DUE and LIFE_LIMIT_DUE[a.tail][0] == kind:
            age_days = int(life_days - LIFE_LIMIT_DUE[a.tail][1])
        if kind == "hydraulics" and a.tail in HS_AT_RISK:
            age_days = int(self.rng.integers(70, 110))
        cycles = int(age_days * a.sorties_per_day)
        return Component(
            tail=a.tail,
            kind=kind,
            position=D.KIND_LABEL[kind],
            part_number=D.part_number(a.type, kind, "01"),
            serial=self.serial(D.KIND_CODE[kind]),
            batch=batch,
            supplier=supplier,
            installed_on=self.d(-age_days),
            hours_since_install=round(cycles * spec["hours_per_sortie"], 1),
            cycles_since_install=cycles,
            life_limit_hours=lim_h,
            life_limit_cycles=lim_c,
            life_limit_days=lim_d,
            condition=round(condition, 1),
            wear_per_day=wear,
        )

    # ------------------------------------------------------------ technical records
    def _fill(self, text: str, tail: str) -> str:
        a = self.aircraft[tail]
        n_eng = D.TYPES[a.type]["engines"]
        return text.format(
            val=int(self.rng.integers(8, 35)),
            val2=int(self.rng.integers(30, 45)),
            eng=int(self.rng.integers(1, n_eng + 1)),
            phase=self.py.choice(T.PHASES),
            side=self.py.choice(T.SIDES),
            sys=self.py.choice(T.SYSTEMS),
            cold=int(self.rng.integers(-24, -6)),
            n=int(self.rng.integers(2, 7)),
        )

    def _comp(self, tail: str, kind: str) -> Component | None:
        cs = [c for c in self.components[tail] if c.kind == kind]
        return self.py.choice(cs) if cs else None

    def add_record(
        self,
        tail: str,
        day: int,
        code: str,
        *,
        record_type: str = "defect",
        downtime: float | None = None,
        aog: bool = False,
        batch: str | None = None,
        narrative: str | None = None,
        action: str | None = None,
        parts: list[str] | None = None,
        man_hours: float | None = None,
    ) -> MaintenanceRecord:
        a = self.aircraft[tail]
        if record_type in ("scheduled", "inspection"):
            entry = next(s for s in T.SCHEDULED if s[0] == code)
            kind = "airframe" if code != "SCH-ENG" else "engine"
            narrative = narrative or self._fill(entry[2], tail)
            action = action or self._fill(entry[3], tail)
            comp = None
            parts = parts or []
        else:
            spec = T.DEFECTS[code]
            kind = spec["kind"]
            comp = self._comp(tail, kind)
            narrative = narrative or self._fill(self.py.choice(spec["narr"]), tail)
            action = action or self.py.choice(spec["act"])
            if parts is None:
                parts = [
                    D.part_number(a.type, kind, sfx)
                    for sfx in spec["parts"][: int(self.rng.integers(1, len(spec["parts"]) + 1))]
                ]
            if downtime is None:
                lo, hi = spec["down"]
                downtime = round(float(self.rng.uniform(lo, hi)), 1)
            if batch is None and kind == "hydraulics" and comp is not None:
                # A record only cites the installed batch if it post-dates the installation.
                batch = comp.batch if self.d(day) >= comp.installed_on else self.batch(kind)
        r = MaintenanceRecord(
            tail=tail,
            base_id=a.base_id,
            component_id=comp.id if comp else None,
            component_kind=kind,
            date=self.d(day),
            record_type=record_type,
            defect_code=code,
            narrative=narrative,
            action_taken=action,
            man_hours=man_hours if man_hours is not None else round(float(self.rng.uniform(2, 14)), 1),
            downtime_days=downtime or 0.0,
            aog=aog,
            parts_used=parts,
            batch=batch,
            technician=self.py.choice(T.TECHNICIANS),
        )
        self.records.append(r)
        return r

    def _defect_weights(self, a: Aircraft, day: int) -> tuple[list[str], np.ndarray]:
        env = self.bases[a.base_id].environment
        codes = list(T.DEFECTS)
        w = []
        month = self.d(day).month
        for c in codes:
            kind = T.DEFECTS[c]["kind"]
            m_env, m_prof = D.wear_multiplier(kind, env, a.sortie_profile)
            wt = (1.0 if kind != "engine" else 0.7) * m_env * m_prof
            if c == "APU-STR" and a.base_id == "IXL":
                wt *= 9 if month in (11, 12, 1, 2, 3) else 3
            if c in ("LG-COR", "FC-COR"):
                wt *= 7 if a.base_id == "JGA" else 0.25
            if c == "AV-MOI" and a.base_id == "TEZ":
                wt *= 3
            if c == "ECS-FLT" and a.base_id == "JDH":
                wt *= 3
            if c == "HYD-LKS":
                wt *= 0.6
            w.append(wt)
        w = np.array(w)
        return codes, w / w.sum()

    def make_history(self) -> None:
        defect_rate = 0.026
        for tail, a in self.aircraft.items():
            # Scheduled programme
            phase_every = int(self.rng.integers(110, 135))
            for day in range(-HISTORY_DAYS + int(self.rng.integers(0, phase_every)), -14, phase_every):
                self.add_record(
                    tail,
                    day,
                    "SCH-PHS",
                    record_type="scheduled",
                    downtime=round(float(self.rng.uniform(5, 9)), 1),
                    man_hours=round(float(self.rng.uniform(60, 140)), 1),
                )
            for day in range(-HISTORY_DAYS + int(self.rng.integers(0, 30)), -3, 30):
                self.add_record(
                    tail,
                    day,
                    "SCH-PRD",
                    record_type="inspection",
                    downtime=0.3,
                    man_hours=round(float(self.rng.uniform(4, 10)), 1),
                )
            for day in range(-HISTORY_DAYS + int(self.rng.integers(0, 180)), -10, 180):
                self.add_record(
                    tail,
                    day,
                    "SCH-ENG",
                    record_type="inspection",
                    downtime=1,
                    man_hours=round(float(self.rng.uniform(6, 16)), 1),
                )
            # Unscheduled defects
            day = -HISTORY_DAYS + float(self.rng.exponential(1 / defect_rate))
            while day < -12:
                codes, p = self._defect_weights(a, int(day))
                code = str(self.rng.choice(codes, p=p))
                aog = bool(self.rng.random() < 0.14)
                lo, hi = T.DEFECTS[code]["down"]
                down = float(self.rng.uniform(lo, hi)) + (float(self.rng.uniform(6, 20)) if aog else 0)
                r = self.add_record(tail, int(day), code, downtime=round(down, 1), aog=aog)
                if aog:
                    r.action_taken += " Aircraft AOG awaiting spare; part demanded from depot."
                day += float(self.rng.exponential(1 / defect_rate))

        # Planted pattern 1: hydraulic seal batch HS-2291 failing early (6 aircraft, 3 bases, last 60 days).
        hs_days = [-57, -49, -41, -33, -22, -4]
        hs_text = [
            (
                "Hydraulic pressure dropping on L/H side after landing, fluid seepage at actuator seal.",
                "Seal kit replaced (old seal batch HS-2291, approx {h} hrs since install). Leak check OK.",
            ),
            (
                "Hyd system 1 pressure low warning, leak traced to seal at pump outlet.",
                "Seal replaced, batch HS-2291 seal found extruded. System bled, leak check OK.",
            ),
            (
                "L/H side hyd press drop ho raha tha landing ke baad, seal se leak mila.",
                "Seal kit badla (batch HS-2291), {h} ghante hi chala tha. Leak check OK.",
            ),
            (
                "Fluid leak from utility system seal, reservoir level low after sortie.",
                "Seal kit replaced; removed seal batch HS-2291 shows premature hardening. Filter changed.",
            ),
            (
                "Hydraulic pressure fluctuating, seal weeping at R/H actuator.",
                "Seal kit replaced, batch HS-2291. Sample sent for lab analysis.",
            ),
            (
                "Hyd system 2 pressure loss in flight, pump outlet seal failed and pump cavitated.",
                "Seal batch HS-2291 failed; hydraulic pump damaged. Pump demanded — aircraft AOG.",
            ),
        ]
        for tail, day, (narr, act) in zip(HS_FAILED, hs_days, hs_text, strict=True):
            hrs = int(self.rng.integers(90, 170))
            r = self.add_record(
                tail,
                day,
                "HYD-LKS",
                batch=BAD_BATCH,
                narrative=narr,
                action=act.format(h=hrs),
                parts=[D.part_number(self.aircraft[tail].type, "hydraulics", "02")],
                downtime=1.5 if tail != "AP-110" else 0.5,
                man_hours=round(float(self.rng.uniform(6, 12)), 1),
            )
            r.component_id = next(c.id for c in self.components[tail] if c.kind == "hydraulics")
        # Normal-life seal replacements from other batches (so the bad batch stands out statistically).
        for _ in range(40):
            tail = self.py.choice(list(self.aircraft))
            day = int(self.rng.integers(-HISTORY_DAYS, -30))
            self.add_record(
                tail,
                day,
                "HYD-LKS",
                batch=self.batch("hydraulics"),
                action=f"Seal kit replaced at end of normal life (approx {int(self.rng.integers(1100, 1700))} hrs). Leak check OK.",
            )

    # ------------------------------------------------------------ open work orders (today's groundings)
    def make_grounded(self) -> list[WorkOrder]:
        orders = []
        for tail, kind, title, wkind, status, remaining, sfx, opened in GROUNDED:
            a = self.aircraft[tail]
            code = {
                "aog": None,
                "phase-inspection": "SCH-PHS",
                "engine-change": "ENG-VIB",
                "defect": None,
                "corrosion": "LG-COR",
            }[wkind]
            comp = next((c for c in self.components[tail] if c.kind == kind), None)
            if wkind == "phase-inspection":
                r = self.add_record(
                    tail,
                    -opened,
                    "SCH-PHS",
                    record_type="scheduled",
                    downtime=opened + remaining,
                    narrative=f"{title} commenced.",
                    action="Work in progress.",
                    man_hours=float(remaining * 16),
                )
            else:
                code = (
                    code
                    or {
                        "hydraulics": "HYD-PMP",
                        "apu": "APU-STR",
                        "avionics": "AV-INT",
                        "fuel": "FUEL-PMP",
                        "landing_gear": "LG-SHK",
                        "flight_controls": "FC-ACT",
                        "engine": "ENG-FOD",
                    }[kind]
                )
                if tail == "AP-133":
                    code = "LG-COR"
                if tail == "AP-131":
                    code = "FC-COR"
                if tail == "AP-146":
                    code = "AV-MOI"
                if tail == "AP-110":
                    code = "HYD-PMP"
                r = self.add_record(
                    tail,
                    -opened,
                    code,
                    downtime=opened + remaining + (18 if status == "awaiting-part" else 0),
                    aog=status == "awaiting-part",
                    narrative=f"{title}. " + self._fill(self.py.choice(T.DEFECTS[code]["narr"]), tail),
                    action="Rectification in progress."
                    if status != "awaiting-part"
                    else "Part demanded; aircraft AOG awaiting spare.",
                )
            a.status = "grounded"
            a.status_reason = title
            spec_title, _, mh = D.TASK_SPEC[kind]
            orders.append(
                WorkOrder(
                    tail=tail,
                    component_id=comp.id if comp else None,
                    title=title,
                    kind=wkind,
                    trade=D.KIND_TRADE[kind],
                    status=status,
                    opened_on=self.d(-opened),
                    remaining_days=remaining,
                    man_hours=float(mh if wkind != "phase-inspection" else 80),
                    part_number=D.part_number(a.type, kind, sfx) if sfx else None,
                )
            )
            orders[-1]._record = r  # type: ignore[attr-defined]
        return orders

    # ------------------------------------------------------------ agencies history
    def make_agency_jobs(self) -> None:
        by_spec: dict[str, list[tuple]] = {}
        for ag in AGENCIES:
            for k in ag[6].split(","):
                by_spec.setdefault(k, []).append(ag)
        repairable = [
            r for r in self.records if r.record_type == "defect" and r.parts_used and r.component_kind in by_spec
        ]
        self.py.shuffle(repairable)
        n = 0
        for r in repairable:
            if n >= 380:
                break
            pn = r.parts_used[0]
            if not pn.endswith(("-01", "-02", "-03", "-04")):
                continue
            ag = self.py.choice(by_spec[r.component_kind])
            aid, _, _, _, tat, _, _, factor, repeat = ag
            sent = r.date
            dur = max(4, int(self.rng.lognormal(np.log(tat * factor), 0.25)))
            returned = sent + timedelta(days=dur)
            open_job = returned > self.as_of
            job = AgencyJob(
                agency_id=aid,
                part_number=pn,
                serial=self.serial("RPR"),
                tail=r.tail,
                component_kind=r.component_kind,
                sent_on=sent,
                promised_days=tat,
                returned_on=None if open_job else returned,
                repeat_failure=(not open_job) and bool(self.rng.random() < repeat),
            )
            r.agency_id = aid
            self.s.add(job)
            n += 1

    # ------------------------------------------------------------ missions, users, ledger
    def make_missions(self) -> None:
        for i, (name, kind, base, typ, req, s, e, prio, scope) in enumerate(MISSIONS, start=1):
            self.s.add(
                Mission(
                    id=f"M{i:02d}",
                    name=name,
                    kind=kind,
                    base_id=base,
                    aircraft_type=typ,
                    required_count=req,
                    start_date=self.d(s),
                    end_date=self.d(e),
                    priority=prio,
                    scope=scope,
                )
            )

    def make_users(self) -> None:
        for r in Role:
            self.s.add(User(name=DEMO_USERS[r], role=r.value))

    def write_records_and_ledger(self, orders: list[WorkOrder]) -> int:
        self.records.sort(key=lambda r: (r.date, r.tail, r.defect_code))
        grounded = {g[0] for g in GROUNDED}
        for r in self.records:
            if r.tail not in grounded:  # history of flying aircraft must have ended before today
                r.downtime_days = round(min(r.downtime_days, (self.as_of - r.date).days - 0.5), 1)
        for r in self.records:
            self.s.add(r)
        self.s.flush()
        for o in orders:
            o.record_id = o._record.id  # type: ignore[attr-defined]
            self.s.add(o)
        chain = Chain(self.s)
        for i, r in enumerate(self.records):
            ts = datetime.combine(r.date, time(9, 0), tzinfo=UTC) + timedelta(minutes=(i * 7) % 480)
            chain.append(
                actor=r.technician,
                role="technician",
                action="record.create",
                entity_type="maintenance_record",
                entity_id=str(r.id),
                tail=r.tail,
                summary=f"{r.defect_code} · {r.narrative[:80]}",
                payload=record_payload(r),
                ts=ts,
            )
        now = datetime.combine(self.as_of, time(8, 30), tzinfo=UTC)
        for o in orders:
            chain.append(
                actor=DEMO_USERS[Role.engineering_officer],
                role=Role.engineering_officer.value,
                action="workorder.open",
                entity_type="work_order",
                entity_id=o.tail,
                tail=o.tail,
                summary=f"Work order open: {o.title}",
                payload={"tail": o.tail, "title": o.title, "status": o.status, "opened_on": o.opened_on.isoformat()},
                ts=now,
            )
        return len(self.records) + len(orders)

    def run(self) -> dict:
        self.make_bases()
        self.make_parts()
        self.make_agencies()
        self.make_fleet()
        self.make_components()
        self.make_history()
        orders = self.make_grounded()
        self.make_agency_jobs()
        self.make_missions()
        self.make_users()
        n_ledger = self.write_records_and_ledger(orders)
        meta = {
            "as_of": self.as_of.isoformat(),
            "engine_data_source": cmapss.source_label(),
            "seeded_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "seed": str(settings.seed),
            "ap112_engine": f"{self.engine_ap112['ds']} unit {self.engine_ap112['unit']}",
        }
        for k, v in meta.items():
            self.s.add(Meta(key=k, value=v))
        self.s.commit()
        return {
            "aircraft": len(self.aircraft),
            "components": sum(len(v) for v in self.components.values()),
            "records": len(self.records),
            "ledger": n_ledger,
            "grounded": len(orders),
            **meta,
        }


def generate(engine=None, as_of: date | None = None, seed: int | None = None) -> dict:
    import app.models  # noqa: F401

    engine = engine or get_engine()
    SQLModel.metadata.drop_all(engine)
    SQLModel.metadata.create_all(engine)
    cmapss.ensure_data()
    with Session(engine) as s:
        return Generator(s, as_of or _as_of(), seed if seed is not None else settings.seed).run()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    from app.ml.train_rul import main as train
    from app.services.rul import models_ready

    if not models_ready():
        log.info("RUL models not found — training first")
        train()
    out = generate()
    log.info("Seeded: %s", out)


if __name__ == "__main__":
    main()
