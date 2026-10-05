from datetime import date, datetime

from sqlmodel import Field, SQLModel


class Part(SQLModel, table=True):
    part_number: str = Field(primary_key=True)
    name: str
    component_kind: str = Field(index=True)
    unit_cost: float  # INR lakh
    lead_time_days: int
    supplier: str
    repairable: bool = True


class StockLevel(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    part_number: str = Field(foreign_key="part.part_number", index=True)
    base_id: str = Field(foreign_key="base.id", index=True)
    on_hand: int
    reorder_point: int
    on_order: int = 0
    order_eta: date | None = None


class Agency(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    kind: str  # depot | oem | field
    location: str
    promised_tat_days: int
    capacity: int  # jobs in work concurrently
    specialities: str  # comma-separated component kinds


class AgencyJob(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    agency_id: str = Field(foreign_key="agency.id", index=True)
    part_number: str
    serial: str
    tail: str
    component_kind: str
    sent_on: date
    promised_days: int
    returned_on: date | None = None
    repeat_failure: bool = False  # failed again within 90 days of return


class CannibalisationAction(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    donor_tail: str
    recipient_tail: str
    part_number: str
    serial: str
    status: str = "approved"  # approved | replaced
    approved_by: str
    replacement_eta: date | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
