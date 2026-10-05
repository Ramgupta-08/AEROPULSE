from datetime import date

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


class Meta(SQLModel, table=True):
    """Key/value facts about the loaded dataset (as-of date, data provenance)."""

    key: str = Field(primary_key=True)
    value: str


class Base(SQLModel, table=True):
    id: str = Field(primary_key=True)  # short code, e.g. "GWL"
    name: str
    lat: float
    lon: float
    environment: str  # semi-arid | desert | temperate | humid | high-altitude | coastal
    hangar_bays: int


class Squadron(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    base_id: str = Field(foreign_key="base.id", index=True)
    aircraft_type: str


class Aircraft(SQLModel, table=True):
    tail: str = Field(primary_key=True)
    type: str  # Fighter Type-A | Transport Type-C | Trainer Type-T
    base_id: str = Field(foreign_key="base.id", index=True)
    squadron_id: str = Field(foreign_key="squadron.id")
    sortie_profile: str  # air-defence | high-g-training | transport | basic-training
    status: str = "ready"  # ready | caution | grounded
    status_reason: str = ""
    total_hours: float = 0
    total_cycles: int = 0
    entered_service: date
    sorties_per_day: float = 0.6


class Component(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    tail: str = Field(foreign_key="aircraft.tail", index=True)
    kind: str  # engine | apu | landing_gear | hydraulics | avionics | fuel | flight_controls | ecs
    position: str  # display name, e.g. "Engine 2"
    part_number: str = Field(index=True)
    serial: str = Field(index=True, unique=True)
    batch: str = Field(index=True)
    supplier: str
    installed_on: date
    hours_since_install: float = 0
    cycles_since_install: int = 0
    life_limit_hours: float
    life_limit_cycles: int
    life_limit_days: int
    # Condition model for non-engine parts: health 0-100 today and wear (health points / day).
    condition: float = 100
    wear_per_day: float = 0.05
    # Engines are driven by a NASA C-MAPSS (or synthetic) run-to-failure trajectory.
    cmapss_dataset: str | None = None
    cmapss_unit: int | None = None
    cmapss_cycle: int | None = None
    cmapss_split: str | None = None  # train | test
    # Planted unknown-fault signature for demo realism: {sensor: {kind: drift|noise, sigma, cycles}}
    telemetry_injection: dict | None = Field(default=None, sa_column=Column(JSON))
    robbed: bool = False
