from collections import Counter

from sqlmodel import func, select

from app.models import Agency, Aircraft, Base, Component, MaintenanceRecord, Mission, Part
from app.services import health as H
from app.services import planning as P


def test_seed_volumes(fleet_session, seeded):
    s = fleet_session
    assert s.exec(select(func.count()).select_from(Base)).one() == 8
    assert s.exec(select(func.count()).select_from(Aircraft)).one() == 60
    assert s.exec(select(func.count()).select_from(Part)).one() == 120
    assert s.exec(select(func.count()).select_from(Agency)).one() == 6
    assert s.exec(select(func.count()).select_from(Mission)).one() == 25
    assert s.exec(select(func.count()).select_from(MaintenanceRecord)).one() >= 3000
    types = Counter(a.type for a in s.exec(select(Aircraft)).all())
    assert types == {"Fighter Type-A": 36, "Transport Type-C": 12, "Trainer Type-T": 12}
    assert s.exec(select(func.count()).select_from(Component).where(Component.kind == "engine")).one() == 132


def test_planted_bad_batch(fleet_session):
    recs = fleet_session.exec(select(MaintenanceRecord).where(MaintenanceRecord.batch == "HS-2291")).all()
    assert len({r.tail for r in recs}) == 6
    assert len({r.base_id for r in recs}) == 3


def test_demo_narrative_is_emergent(fleet_session):
    fleet = H.fleet(fleet_session)
    mc = sum(1 for a in fleet if a.status != "grounded")
    assert 70 <= 100 * mc / 60 <= 76
    ap112 = next(a for a in fleet if a.aircraft.tail == "AP-112")
    e2 = next(c for c in ap112.components if c.position == "Engine 2")
    assert 14 <= e2.p50 <= 22 and e2.p10 < e2.p50 < e2.p90
    st = P.load_state(fleet_session)
    assert sum(1 for t in st.tasks if t.tail == "AP-112") == 3
    assert any(t["from_base"] == "JDH" and t["to_base"] == "GWL" for t in st.transfers)
