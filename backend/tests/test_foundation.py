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


def test_bases_readiness(fleet_client):
    bases = fleet_client.get("/api/bases").json()
    assert len(bases) == 8
    assert sum(b["aircraft"] for b in bases) == 60
    gwl = next(b for b in bases if b["id"] == "GWL")
    assert gwl["readiness_pct"] == round(100 * (gwl["ready"] + gwl["caution"]) / gwl["aircraft"], 1)
    assert fleet_client.get("/api/bases/XXX").status_code == 404
