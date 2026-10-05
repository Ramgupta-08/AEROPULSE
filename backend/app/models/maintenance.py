from datetime import date as Date
from datetime import datetime

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
    parts_used: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    batch: str | None = Field(default=None, index=True)
    technician: str
    agency_id: str | None = Field(default=None, foreign_key="agency.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PredictionFeedback(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    component_id: int = Field(foreign_key="component.id")
    tail: str
    verdict: str  # correct | early | late
    predicted_p50: float
    note: str = ""
    user: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
