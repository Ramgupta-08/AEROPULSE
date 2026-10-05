from sqlmodel import select

from app.models import MaintenanceRecord
from app.services.hashchain import verify


def test_chain_verifies_and_detects_tamper(fleet_session):
    ok = verify(fleet_session)
    assert ok["ok"] and ok["total"] >= 3000
    r = fleet_session.exec(select(MaintenanceRecord).where(MaintenanceRecord.tail == "AP-112")).first()
    r.man_hours += 5
    fleet_session.add(r)
    fleet_session.commit()
    bad = verify(fleet_session)
    assert not bad["ok"]
    assert bad["broken"][0]["entity_id"] == str(r.id)
    assert "man_hours" in bad["broken"][0]["problems"][0]
