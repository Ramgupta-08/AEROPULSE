"""Free-text templates for simulated technician logbook entries (English + some Hinglish)."""

from __future__ import annotations

# code -> (kind, title, [narratives], [actions], parts suffixes, typical downtime days)
DEFECTS: dict[str, dict] = {
    "ENG-EGT": {
        "kind": "engine",
        "title": "EGT exceedance",
        "narr": [
            "Pilot reported EGT exceedance {val} deg C above limit during {phase}. Engine {eng} trend data reviewed.",
            "EGT spread high on engine {eng} after {phase}, crew snag entered.",
            "Engine {eng} EGT {val} deg above normal band during climb, auto-recorded by HUMS.",
            "{phase} ke time engine {eng} EGT limit cross hua, HUMS download kiya.",
        ],
        "act": [
            "Borescope inspection of HPT carried out, minor coating loss noted within limits. Trend monitoring increased.",
            "Thermocouple harness checked, one T5 probe found degraded and replaced. Ground run satisfactory.",
            "Engine trim run carried out, parameters within limits. Placed on watch list.",
        ],
        "parts": ["05"],
        "down": (1, 3),
    },
    "ENG-VIB": {
        "kind": "engine",
        "title": "High engine vibration",
        "narr": [
            "Engine {eng} vibration {val} ips at max power, above advisory limit.",
            "Vibration advisory on engine {eng} during {phase}. HUMS shows rising trend over last sorties.",
            "Engine {eng} me vibration zyada aa raha hai {phase} ke dauran, {val} ips record hua.",
        ],
        "act": [
            "Fan balance check carried out, trim weights adjusted. Ground run vibration 0.6 ips.",
            "Oil sample sent for SOAP, bearing debris within limits. Monitoring every sortie.",
            "Engine mounts inspected, one isolator found deteriorated and replaced.",
        ],
        "parts": ["04"],
        "down": (1, 4),
    },
    "ENG-OIL": {
        "kind": "engine",
        "title": "Oil pressure fluctuation",
        "narr": [
            "Oil pressure fluctuating on engine {eng} between {val} and {val2} psi in cruise.",
            "Engine {eng} oil press low indication on ground idle.",
            "Engine {eng} oil pressure gir raha tha idle pe, crew ne report kiya.",
        ],
        "act": [
            "Oil pressure transmitter replaced, ground run satisfactory.",
            "Oil filter changed, chip detector clean. Leak check satisfactory.",
            "Oil pump assembly replaced, pressure steady at 52 psi.",
        ],
        "parts": ["04"],
        "down": (1, 5),
    },
    "ENG-FOD": {
        "kind": "engine",
        "title": "FOD damage",
        "narr": [
            "FOD damage found on engine {eng} fan blade during pre-flight inspection.",
            "Nick on first-stage compressor blade, engine {eng}, observed in borescope.",
        ],
        "act": [
            "Blade blended within limits per manual, borescope re-inspection OK.",
            "Engine removed for module repair, spare engine installed.",
        ],
        "parts": ["02"],
        "down": (2, 12),
    },
    "APU-STR": {
        "kind": "apu",
        "title": "APU start failure",
        "narr": [
            "APU failed to start on first attempt, cold soak overnight, OAT {cold} deg C.",
            "APU start aborted, slow light-off, EGT rise sluggish. Outside temp {cold} deg C.",
            "APU start nahi hua subah, temperature {cold} deg tha. Teesre attempt pe start hua.",
            "APU hung start during early morning launch, ambient {cold} deg C.",
        ],
        "act": [
            "Igniter exciter replaced, APU start satisfactory on 2 attempts.",
            "Starter-generator brushes worn, starter-generator replaced. Start time 38 s.",
            "APU fuel control adjusted, cold start procedure briefed. Satisfactory.",
        ],
        "parts": ["03", "01"],
        "down": (1, 4),
    },
    "APU-EGT": {
        "kind": "apu",
        "title": "APU over-temperature",
        "narr": [
            "APU auto shutdown due to over-temperature during ground run.",
            "APU EGT high on load, bleed demand high.",
        ],
        "act": ["APU temperature sensor replaced, ground run OK.", "APU inlet cleaned, load test satisfactory."],
        "parts": ["05"],
        "down": (1, 2),
    },
    "LG-COR": {
        "kind": "landing_gear",
        "title": "Landing gear corrosion",
        "narr": [
            "Corrosion found on {side} main gear axle during weekly inspection.",
            "Pitting corrosion on {side} MLG torque link, salt deposits visible.",
            "{side} main gear me corrosion mila, salt jama hua tha wheel well me.",
            "Surface corrosion on nose gear steering collar, coastal exposure.",
        ],
        "act": [
            "Corrosion removed, area treated with inhibitor and repainted. Inspection interval reduced.",
            "Torque link replaced, anti-corrosion kit applied to wheel well.",
            "Fresh-water wash carried out, CPC applied, re-inspection in 15 days.",
        ],
        "parts": ["05"],
        "down": (1, 5),
    },
    "LG-BRK": {
        "kind": "landing_gear",
        "title": "Brake wear",
        "narr": ["{side} brake wear pin at limit.", "Brake temperature high {side} after landing, brake unit worn."],
        "act": ["Brake unit replaced, taxi test satisfactory.", "Brake unit changed, wear pin checked."],
        "parts": ["02"],
        "down": (1, 2),
    },
    "LG-TYR": {
        "kind": "landing_gear",
        "title": "Tyre cut / wear",
        "narr": ["Cut on {side} main wheel tyre beyond limits.", "{side} main tyre tread worn to limit."],
        "act": ["Wheel assembly replaced, pressure checked.", "Tyre changed and balanced."],
        "parts": ["03"],
        "down": (0.5, 1),
    },
    "LG-SHK": {
        "kind": "landing_gear",
        "title": "Shock strut leak",
        "narr": [
            "Hydraulic fluid leak from {side} shock strut, extension below limits.",
            "{side} strut leak aur extension kam mila.",
        ],
        "act": ["Strut serviced and seals replaced, extension within limits.", "Shock strut replaced from stores."],
        "parts": ["01"],
        "down": (2, 6),
    },
    "HYD-LKS": {
        "kind": "hydraulics",
        "title": "Hydraulic seal leak",
        "narr": [
            "Hydraulic pressure dropping on {side} side after landing, fluid seepage at actuator seal.",
            "Hyd system {sys} pressure low warning, leak traced to seal at pump outlet.",
            "{side} side hyd press drop ho raha tha landing ke baad, seal se leak mila.",
            "Fluid leak from {sys} system seal, reservoir level low after sortie.",
        ],
        "act": [
            "Seal kit replaced, leak check and pressure test satisfactory.",
            "Seal replaced, system bled and serviced. Leak check OK.",
            "Seal kit changed, filter element replaced, contamination check OK.",
        ],
        "parts": ["02"],
        "down": (1, 3),
    },
    "HYD-PRS": {
        "kind": "hydraulics",
        "title": "Hydraulic pressure drop",
        "narr": [
            "System {sys} pressure fluctuating {val} psi on ground run.",
            "Hyd {sys} pressure caution light in flight.",
        ],
        "act": ["Pressure transmitter replaced, ground test satisfactory.", "Accumulator precharge corrected."],
        "parts": ["05"],
        "down": (1, 2),
    },
    "HYD-PMP": {
        "kind": "hydraulics",
        "title": "Hydraulic pump failure",
        "narr": [
            "Hydraulic pump {sys} output low, case drain flow high.",
            "Hyd pump noise and pressure loss on system {sys}.",
        ],
        "act": [
            "Hydraulic pump replaced, system flushed and bled.",
            "Pump replaced, filter changed, ground run satisfactory.",
        ],
        "parts": ["01", "04"],
        "down": (2, 6),
    },
    "AV-INT": {
        "kind": "avionics",
        "title": "Intermittent display",
        "narr": [
            "MFD {side} blanking intermittently in flight.",
            "Display flicker on {side} MFD during taxi.",
            "{side} MFD bar bar blank ho raha tha.",
        ],
        "act": ["MFD replaced, BITE satisfactory.", "Connector reseated and cleaned, ground test OK."],
        "parts": ["03"],
        "down": (0.5, 2),
    },
    "AV-MOI": {
        "kind": "avionics",
        "title": "Moisture ingress",
        "narr": [
            "Moisture found in avionics bay connector, corrosion on pins.",
            "Condensation in nose avionics bay after rain, nav fault.",
        ],
        "act": [
            "Connectors cleaned, sealed connector kit fitted, desiccant replaced.",
            "Bay dried, connector replaced, BITE OK.",
        ],
        "parts": ["05"],
        "down": (1, 3),
    },
    "AV-NAV": {
        "kind": "avionics",
        "title": "INS drift",
        "narr": ["INS drift {val} nm/hr beyond limit.", "Navigation alignment fault on ground."],
        "act": ["INU replaced, alignment satisfactory.", "INU software reloaded, alignment test OK."],
        "parts": ["02"],
        "down": (1, 3),
    },
    "FUEL-LK": {
        "kind": "fuel",
        "title": "Fuel leak",
        "narr": [
            "Fuel seepage from {side} wing tank access panel.",
            "Fuel smell in {side} wheel well, seepage at coupling.",
        ],
        "act": ["Panel resealed with sealant kit, leak check OK.", "Coupling seal replaced, leak check satisfactory."],
        "parts": ["05"],
        "down": (1, 4),
    },
    "FUEL-PMP": {
        "kind": "fuel",
        "title": "Boost pump fault",
        "narr": ["Fuel boost pump {side} low pressure caution.", "Boost pump {side} tripping on ground."],
        "act": ["Boost pump replaced, functional check OK.", "Pump relay replaced, satisfactory."],
        "parts": ["01"],
        "down": (1, 3),
    },
    "FC-ACT": {
        "kind": "flight_controls",
        "title": "Actuator fault",
        "narr": ["{side} aileron actuator slow response on BIT.", "Flight control caution, {side} elevator actuator."],
        "act": ["Actuator replaced, rigging and functional check OK.", "Servo valve replaced, BIT satisfactory."],
        "parts": ["01", "04"],
        "down": (1, 4),
    },
    "FC-COR": {
        "kind": "flight_controls",
        "title": "Control hinge corrosion",
        "narr": [
            "Corrosion on {side} flap hinge bracket.",
            "Hinge bushing corrosion on {side} aileron, salt deposits.",
        ],
        "act": ["Bushings replaced, corrosion treatment applied.", "Hinge cleaned and treated, re-inspect in 30 days."],
        "parts": ["05"],
        "down": (1, 3),
    },
    "ECS-FLT": {
        "kind": "ecs",
        "title": "ECS filter clogging",
        "narr": [
            "Cockpit cooling poor, ECS dust filter clogged.",
            "ECS filter differential pressure high after sortie, dust ingress.",
            "Cockpit garam ho raha tha, ECS filter choke mila.",
        ],
        "act": ["ECS dust filter replaced, cooling satisfactory.", "Filter changed and ducts cleaned."],
        "parts": ["03"],
        "down": (0.5, 1),
    },
    "ECS-PAC": {
        "kind": "ecs",
        "title": "ECS pack trip",
        "narr": ["ECS pack tripped in flight, cabin temperature rising.", "Pack valve stuck, no cooling on ground."],
        "act": ["Pack valve replaced, functional check OK.", "Temperature controller replaced."],
        "parts": ["01", "04"],
        "down": (1, 2),
    },
}

SCHEDULED = [
    (
        "SCH-PHS",
        "Phase inspection",
        "Scheduled phase inspection carried out per maintenance programme.",
        "All items completed, {n} minor findings rectified. Aircraft serviceable.",
    ),
    (
        "SCH-PRD",
        "Periodic inspection",
        "Periodic {n}-day inspection carried out.",
        "Inspection complete, lubrication and servicing done.",
    ),
    (
        "SCH-ENG",
        "Engine borescope",
        "Scheduled engine borescope inspection, all engines.",
        "No defects beyond limits. Next due as per schedule.",
    ),
]

TECHNICIANS = [
    "Sgt R. Yadav",
    "Cpl A. Khan",
    "Sgt M. Pillai",
    "JWO D. Singh",
    "Cpl S. Das",
    "Sgt V. Rawat",
    "Cpl P. Nair",
    "Sgt K. Reddy",
    "Cpl H. Gill",
    "WO T. Joseph",
    "Sgt N. Bora",
    "Cpl L. Thapa",
    "Sgt J. Kumar",
    "Cpl G. Mehta",
]
PHASES = ["take-off", "climb", "max power run", "recovery", "air combat manoeuvres", "ground run", "descent"]
SIDES = ["L/H", "R/H"]
SYSTEMS = ["1", "2", "utility", "flight control"]
