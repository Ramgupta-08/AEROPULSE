from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.core import db


@pytest.fixture()
def empty_engine():
    import app.models  # noqa: F401

    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(eng)
    db.set_engine(eng)
    yield eng
    db.set_engine(None)


@pytest.fixture()
def client(empty_engine):
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def session(empty_engine):
    with Session(empty_engine) as s:
        yield s
