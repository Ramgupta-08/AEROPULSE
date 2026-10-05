EO = {"X-Role": "engineering_officer"}
LOG = {"X-Role": "logistics"}


def test_inventory_demand_and_roles(fleet_client):
    r = fleet_client.get("/api/spares", headers=LOG).json()
    assert r["summary"]["lines"] > 100 and r["summary"]["demand_30d"] > 0
    assert {i["status"] for i in r["items"]} <= {"shortfall", "transfer", "reorder", "ok"}
    assert fleet_client.get("/api/spares", headers={"X-Role": "commander"}).status_code == 403


def test_transfer_suggestion_jodhpur_to_gwalior(fleet_client):
    tr = fleet_client.get("/api/spares/transfers", headers=LOG).json()
    pump = next(t for t in tr if t["tail"] == "AP-110")
    assert pump["from_name"] == "Jodhpur" and pump["to_name"] == "Gwalior" and pump["days_saved"] > 0
    assert "transfer instead of ordering" in pump["message"]


def test_cannibalisation_requires_eo_and_is_tracked(fleet_client):
    adv = fleet_client.get("/api/spares/cannibalisation", headers=LOG).json()
    s = adv["suggestions"][0]
    assert (s["recipient"], s["donor"]) == ("AP-117", "AP-133") and s["readiness_gain_aircraft_days"] > 0
    body = {"recipient": s["recipient"], "donor": s["donor"]}
    assert fleet_client.post("/api/spares/cannibalisation/approve", json=body, headers=LOG).status_code == 403
    ok = fleet_client.post("/api/spares/cannibalisation/approve", json=body, headers=EO)
    assert ok.status_code == 200
    after = fleet_client.get("/api/spares/cannibalisation", headers=EO).json()
    assert not after["suggestions"] and after["tracked"][0]["status"] == "approved"
    detail = fleet_client.get("/api/aircraft/AP-117", headers=EO).json()
    assert detail["work_order"]["status"] == "in-work"
    done = fleet_client.post(f"/api/spares/cannibalisation/{after['tracked'][0]['id']}/replaced", headers=EO)
    assert done.json()["status"] == "replaced"


def test_batch_watch_detects_hs2291(fleet_client):
    batches = fleet_client.get("/api/spares/batch-watch", headers=LOG).json()
    flagged = [b for b in batches if b["flagged"]]
    assert [b["batch"] for b in flagged] == ["HS-2291"]
    assert len(flagged[0]["aircraft"]) == 6 and len(flagged[0]["bases"]) == 3
    assert {r["tail"] for r in flagged[0]["installed_at_risk"]} == {"AP-112", "AP-125"}


def test_agency_scorecard(fleet_client):
    sc = fleet_client.get("/api/agencies/scorecard", headers=LOG).json()
    assert len(sc["agencies"]) == 6 and sc["agencies"][0]["rank"] == 1
    assert sc["agencies"][-1]["id"] == "BRD-N"
    assert {r["component_kind"] for r in sc["routing"]} >= {"engine", "hydraulics"}
