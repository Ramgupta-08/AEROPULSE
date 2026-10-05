from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.core import db
from app.services import rul

AS_OF = date(2026, 10, 5)


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


# ---------------------------------------------------------------- seeded fleet (shared across a test session)
@pytest.fixture(scope="session")
def seeded_path(tmp_path_factory):
    if not rul.models_ready():
        pytest.skip("RUL models not trained — run `make train`")
    from app.seed.generate import generate

    path = tmp_path_factory.mktemp("db") / "seeded.db"
    eng = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    stats = generate(eng, as_of=AS_OF)
    eng.dispose()
    return path, stats


@pytest.fixture()
def seeded(seeded_path, tmp_path):
    """A fresh copy of the seeded database per test, so tests may write freely."""
    import shutil

    src, stats = seeded_path
    dst = tmp_path / "fleet.db"
    shutil.copy(src, dst)
    eng = create_engine(f"sqlite:///{dst}", connect_args={"check_same_thread": False})
    db.set_engine(eng)
    yield eng, stats
    db.set_engine(None)
    eng.dispose()


@pytest.fixture()
def fleet_client(seeded):
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def fleet_session(seeded):
    with Session(seeded[0]) as s:
        yield s
