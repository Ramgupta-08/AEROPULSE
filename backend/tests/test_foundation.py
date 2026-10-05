from datetime import date

from app.models import Aircraft, Base, Squadron


def test_ping(client):
    r = client.get("/api/ping")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "service": "aeropulse"}


def test_meta_reports_role(client):
    r = client.get("/api/meta", headers={"X-Role": "auditor"})
    assert r.status_code == 200
    body = r.json()
    assert body["role"]["label"] == "Auditor"
    assert "records" in body["role"]["areas"]
    assert "spares" not in body["role"]["areas"]
    assert len(body["roles"]) == 5


def test_unknown_role_rejected(client):
    assert client.get("/api/meta", headers={"X-Role": "intruder"}).status_code == 401


def test_bases_readiness(client, session):
    session.add(Base(id="GWL", name="Gwalior", lat=26.2, lon=78.2, environment="semi-arid", hangar_bays=4))
    session.add(Squadron(id="S1", name="Squadron Kestrel", base_id="GWL", aircraft_type="Fighter Type-A"))
    for i, st in enumerate(["ready", "ready", "caution", "grounded"]):
        session.add(
            Aircraft(
                tail=f"AP-10{i}",
                type="Fighter Type-A",
                base_id="GWL",
                squadron_id="S1",
                sortie_profile="air-defence",
                status=st,
                entered_service=date(2015, 1, 1),
            )
        )
    session.commit()
    r = client.get("/api/bases")
    assert r.status_code == 200
    (b,) = r.json()
    assert (b["ready"], b["caution"], b["grounded"], b["readiness_pct"]) == (2, 1, 1, 75.0)
    assert client.get("/api/bases/XXX").status_code == 404
