from datetime import UTC, datetime
from datetime import date as Date

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


class MaintenanceRecord(SQLModel, table=True):
    """Technical record / logbook entry."""

    id: int | None = Field(default=None, primary_key=True)
    tail: str = Field(foreign_key="aircraft.tail", index=True)
    base_id: str = Field(foreign_key="base.id", index=True)
    component_id: int | None = Field(default=None, foreign_key="component.id")
    component_kind: str = Field(index=True)
    date: Date = Field(index=True)
    record_type: str  # defect | scheduled | inspection | rectification
    defect_code: str = Field(index=True)
    narrative: str
    action_taken: str
    man_hours: float
    downtime_days: float = 0  # aircraft not mission-capable for this many days from `date`
    aog: bool = False  # aircraft-on-ground awaiting parts
    parts_used: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    batch: str | None = Field(default=None, index=True)
    technician: str
    agency_id: str | None = Field(default=None, foreign_key="agency.id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class PredictionFeedback(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    component_id: int = Field(foreign_key="component.id")
    tail: str
    verdict: str  # correct | early | late
    predicted_p50: float
    note: str = ""
    user: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class WorkOrder(SQLModel, table=True):
    """Open maintenance work currently keeping an aircraft on the ground."""

    id: int | None = Field(default=None, primary_key=True)
    tail: str = Field(foreign_key="aircraft.tail", index=True)
    component_id: int | None = Field(default=None, foreign_key="component.id")
    title: str
    kind: str  # phase-inspection | defect | aog | engine-change | corrosion
    trade: str  # engine | airframe | avionics
    status: str  # in-work | awaiting-part | awaiting-slot
    opened_on: Date
    remaining_days: int
    man_hours: float
    part_number: str | None = None
    record_id: int | None = Field(default=None, foreign_key="maintenancerecord.id")
