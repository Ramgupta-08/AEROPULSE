"""Shared domain constants: bases, aircraft types, components, wear multipliers, parts catalogue."""

from __future__ import annotations

# id, name, lat, lon, environment, hangar bays
BASES = [
    ("GWL", "Gwalior", 26.2933, 78.2278, "semi-arid", 3),
    ("JDH", "Jodhpur", 26.2511, 73.0489, "desert", 2),
    ("PNQ", "Pune", 18.5821, 73.9197, "temperate", 2),
    ("TEZ", "Tezpur", 26.7091, 92.7847, "humid", 2),
    ("IXL", "Leh", 34.1359, 77.5465, "high-altitude", 2),
    ("JGA", "Jamnagar", 22.4655, 70.0126, "coastal", 2),
    ("BLR", "Bengaluru", 13.1355, 77.6061, "temperate", 3),
    ("HDN", "Hindan", 28.7077, 77.3586, "temperate", 3),
]

FIGHTER, TRANSPORT, TRAINER = "Fighter Type-A", "Transport Type-C", "Trainer Type-T"
TYPE_CODE = {FIGHTER: "FA", TRANSPORT: "TC", TRAINER: "TT"}
TYPES = {
    FIGHTER: {"engines": 2, "sorties_per_day": 0.75, "hours_per_sortie": 1.3},
    TRANSPORT: {"engines": 4, "sorties_per_day": 0.5, "hours_per_sortie": 3.4},
    TRAINER: {"engines": 1, "sorties_per_day": 1.1, "hours_per_sortie": 1.0},
}

KINDS = ["engine", "apu", "landing_gear", "hydraulics", "avionics", "fuel", "flight_controls", "ecs"]
KIND_LABEL = {
    "engine": "Engine",
    "apu": "APU",
    "landing_gear": "Landing Gear",
    "hydraulics": "Hydraulics",
    "avionics": "Avionics",
    "fuel": "Fuel System",
    "flight_controls": "Flight Controls",
    "ecs": "Environmental Control",
}
KIND_TRADE = {
    "engine": "engine",
    "apu": "engine",
    "landing_gear": "airframe",
    "hydraulics": "airframe",
    "avionics": "avionics",
    "fuel": "airframe",
    "flight_controls": "airframe",
    "ecs": "avionics",
}
# Base wear (condition points per day at multiplier 1.0) and life limits (hours, cycles, calendar days).
KIND_WEAR = {
    "apu": 0.075,
    "landing_gear": 0.06,
    "hydraulics": 0.065,
    "avionics": 0.05,
    "fuel": 0.045,
    "flight_controls": 0.05,
    "ecs": 0.06,
}
LIFE_LIMITS = {
    "engine": (4000, 1500, 3650),
    "apu": (2000, 2500, 2920),
    "landing_gear": (4000, 3000, 2190),
    "hydraulics": (1800, 1600, 1460),
    "avionics": (5000, 4000, 2920),
    "fuel": (3000, 2600, 2190),
    "flight_controls": (3500, 3000, 2555),
    "ecs": (2500, 2200, 1825),
}
# Maintenance task characteristics per kind: (title, duration days, man-hours)
TASK_SPEC = {
    "engine": ("Engine removal & core module change", 4, 96),
    "apu": ("APU starter-generator replacement", 2, 24),
    "landing_gear": ("Landing gear overhaul & corrosion treatment", 3, 48),
    "hydraulics": ("Hydraulic seal kit replacement & leak check", 2, 20),
    "avionics": ("Avionics LRU replacement & BITE test", 1, 12),
    "fuel": ("Fuel boost pump replacement", 2, 18),
    "flight_controls": ("Flight control actuator replacement", 2, 28),
    "ecs": ("ECS pack valve & filter replacement", 1, 10),
}
INSPECTION_SPEC = ("Landing gear life-limit inspection", 1, 10)

# Documented wear multipliers (non-engine components). Shown transparently in the UI.
ENV_MULTIPLIERS = {
    "desert": {"landing_gear": 1.25, "ecs": 1.30, "hydraulics": 1.15, "flight_controls": 1.10},
    "coastal": {"landing_gear": 1.30, "flight_controls": 1.20, "avionics": 1.15, "fuel": 1.10},
    "high-altitude": {"apu": 1.40, "hydraulics": 1.20, "ecs": 1.20, "landing_gear": 1.10},
    "humid": {"avionics": 1.25, "ecs": 1.15, "fuel": 1.10},
    "semi-arid": {"ecs": 1.10, "landing_gear": 1.10},
    "temperate": {},
}
ENV_NOTES = {
    "desert": "Sand and dust ingress: abrasion on gear, ECS filters and hydraulic seals",
    "coastal": "Salt-laden air: accelerated corrosion on gear, control hinges and connectors",
    "high-altitude": "Cold soak and thin air: hard APU starts, hydraulic seal hardening",
    "humid": "Moisture ingress: avionics connectors, ECS and fuel microbial growth",
    "semi-arid": "Dust and heat: ECS load and gear wear",
    "temperate": "Reference environment (no adjustment)",
}
PROFILE_MULTIPLIERS = {
    "high-g-training": {"flight_controls": 1.25, "landing_gear": 1.20, "hydraulics": 1.15},
    "air-defence": {"flight_controls": 1.10},
    "transport": {"landing_gear": 1.15, "apu": 1.10},
    "basic-training": {"landing_gear": 1.30, "flight_controls": 1.05},
}
PROFILE_NOTES = {
    "high-g-training": "High-G manoeuvring: control actuators, gear and hydraulics loads",
    "air-defence": "Quick-reaction sorties: moderate control-system loading",
    "transport": "Heavy landings and long APU use on ground",
    "basic-training": "Frequent touch-and-go landings",
}

FAILURE_THRESHOLD = 20.0  # condition below which a component is considered failed


def wear_multiplier(kind: str, environment: str, profile: str) -> tuple[float, float]:
    return ENV_MULTIPLIERS.get(environment, {}).get(kind, 1.0), PROFILE_MULTIPLIERS.get(profile, {}).get(kind, 1.0)


# Parts catalogue: 5 parts per component kind per aircraft type = 120 part numbers.
# (suffix, name, unit cost lakh INR, lead time days, repairable)
PART_TEMPLATES = {
    "engine": [
        ("01", "Engine core module", 420.0, 60, True),
        ("02", "HPT blade set", 85.0, 45, False),
        ("03", "Fuel control unit", 38.0, 35, True),
        ("04", "Oil pump assembly", 9.5, 25, True),
        ("05", "Igniter plug set", 0.8, 14, False),
    ],
    "apu": [
        ("01", "APU starter-generator", 22.0, 30, True),
        ("02", "APU fuel control", 11.0, 28, True),
        ("03", "APU igniter exciter", 2.4, 18, True),
        ("04", "APU oil filter", 0.3, 10, False),
        ("05", "APU temperature sensor", 1.1, 14, False),
    ],
    "landing_gear": [
        ("01", "Main gear shock strut", 34.0, 40, True),
        ("02", "Brake unit", 6.5, 21, True),
        ("03", "Main wheel tyre", 1.2, 12, False),
        ("04", "Retraction actuator", 12.0, 30, True),
        ("05", "Anti-corrosion kit", 0.4, 7, False),
    ],
    "hydraulics": [
        ("01", "Hydraulic pump", 18.0, 21, True),
        ("02", "Hydraulic seal kit", 0.6, 21, False),
        ("03", "Accumulator", 5.5, 25, True),
        ("04", "Hydraulic filter element", 0.25, 10, False),
        ("05", "Pressure transmitter", 1.8, 18, False),
    ],
    "avionics": [
        ("01", "Mission computer", 55.0, 45, True),
        ("02", "Inertial navigation unit", 48.0, 50, True),
        ("03", "Multi-function display", 16.0, 30, True),
        ("04", "VHF/UHF radio", 7.5, 25, True),
        ("05", "Sealed connector kit", 0.5, 10, False),
    ],
    "fuel": [
        ("01", "Fuel boost pump", 8.0, 25, True),
        ("02", "Fuel quantity probe", 2.2, 20, False),
        ("03", "Refuel valve", 3.1, 20, True),
        ("04", "Fuel filter element", 0.2, 8, False),
        ("05", "Tank sealant kit", 0.35, 10, False),
    ],
    "flight_controls": [
        ("01", "Control surface actuator", 14.0, 35, True),
        ("02", "Trim actuator", 6.0, 28, True),
        ("03", "Control rod end bearing", 0.4, 12, False),
        ("04", "Servo valve", 9.0, 30, True),
        ("05", "Hinge bushing kit", 0.3, 10, False),
    ],
    "ecs": [
        ("01", "ECS pack valve", 4.5, 21, True),
        ("02", "Air cycle machine", 15.0, 35, True),
        ("03", "ECS dust filter", 0.15, 7, False),
        ("04", "Temperature controller", 2.6, 20, True),
        ("05", "Water separator", 1.1, 14, False),
    ],
}
KIND_CODE = {
    "engine": "ENG",
    "apu": "APU",
    "landing_gear": "LG",
    "hydraulics": "HYD",
    "avionics": "AV",
    "fuel": "FUEL",
    "flight_controls": "FC",
    "ecs": "ECS",
}
# Part consumed by the predictive / corrective task for each component kind.
TASK_PART_SUFFIX = {
    "engine": "01",
    "apu": "01",
    "landing_gear": "02",
    "hydraulics": "02",
    "avionics": "01",
    "fuel": "01",
    "flight_controls": "01",
    "ecs": "01",
}


def part_number(aircraft_type: str, kind: str, suffix: str) -> str:
    return f"{TYPE_CODE[aircraft_type]}-{KIND_CODE[kind]}-{suffix}"


def task_part(aircraft_type: str, kind: str) -> str:
    return part_number(aircraft_type, kind, TASK_PART_SUFFIX[kind])


TRANSFER_DAYS = 2  # inter-base air/road transfer of a spare
