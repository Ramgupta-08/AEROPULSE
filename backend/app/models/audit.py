from datetime import datetime

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


class LedgerEntry(SQLModel, table=True):
    """Append-only SHA-256 hash chain over records, schedule changes and approvals."""

    seq: int | None = Field(default=None, primary_key=True)
    ts: datetime = Field(index=True)
    actor: str = Field(index=True)
    role: str = Field(index=True)
    action: str = Field(index=True)  # record.create | schedule.optimise | schedule.move | approval ...
    entity_type: str
    entity_id: str = Field(index=True)
    tail: str | None = Field(default=None, index=True)
    summary: str
    payload: dict = Field(default_factory=dict, sa_column=Column(JSON))
    prev_hash: str
    hash: str


class User(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    role: str
