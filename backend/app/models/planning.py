from datetime import UTC, date, datetime

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


class Mission(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    kind: str  # exercise | surge | deployment | training | transport
    base_id: str = Field(foreign_key="base.id", index=True)
    aircraft_type: str
    required_count: int
    start_date: date
    end_date: date
    priority: int = 2  # 1 critical .. 3 routine
    scope: str = "base"  # base: aircraft must be at base_id | fleet: any base may contribute


class HangarBay(SQLModel, table=True):
    id: str = Field(primary_key=True)
    base_id: str = Field(foreign_key="base.id", index=True)
    name: str


class TechnicianShift(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    base_id: str = Field(foreign_key="base.id", index=True)
    trade: str  # engine | airframe | avionics
    technicians: int
    hours_per_day: float = 8


class ScheduleBlock(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    plan: str = Field(index=True)  # "current" (AeroPulse) | "reactive"
    tail: str = Field(index=True)
    base_id: str
    bay_id: str
    start_day: int  # offset from as-of date
    duration_days: int
    tasks: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    bundled_count: int = 0
    locked: bool = False


class Scenario(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    actions: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    result: dict = Field(default_factory=dict, sa_column=Column(JSON))
    created_by: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
