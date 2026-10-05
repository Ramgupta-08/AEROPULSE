EO = {"X-Role": "engineering_officer"}


def test_engines_ranked_with_reasons(fleet_client):
    r = fleet_client.get("/api/health/engines", headers=EO)
    assert r.status_code == 200
    engines = r.json()
    assert len(engines) == 132
    assert engines[0]["p50"] <= engines[-1]["p50"]
    ap112 = next(e for e in engines if e["tail"] == "AP-112" and e["position"] == "Engine 2")
    assert ap112["reasons"] and all(x["impact"] < 0 for x in ap112["reasons"])


def test_anomalies_find_planted_faults(fleet_client):
    flagged = {(a["tail"], a["position"]) for a in fleet_client.get("/api/anomalies", headers=EO).json()}
    assert {("AP-119", "Engine 1"), ("AP-139", "Engine 3")} <= flagged


def test_model_card_and_feedback(fleet_client):
    card = fleet_client.get("/api/health/model-card", headers=EO).json()
    assert card["datasets"][0]["test"]["rmse"] > 0
    assert card["feedback"]["total"] == 0
    comp = fleet_client.get("/api/aircraft/AP-112", headers=EO).json()["components"][1]
    r = fleet_client.post("/api/health/feedback", json={"component_id": comp["id"], "verdict": "correct"}, headers=EO)
    assert r.status_code == 200
    assert fleet_client.get("/api/health/model-card", headers=EO).json()["feedback"]["correct"] == 1
    denied = fleet_client.post(
        "/api/health/feedback", json={"component_id": comp["id"], "verdict": "early"}, headers={"X-Role": "commander"}
    )
    assert denied.status_code == 403


def test_adjustments(fleet_client):
    rows = fleet_client.get("/api/health/adjustments", headers=EO).json()
    assert rows and rows[0]["combined"] >= rows[-1]["combined"] > 1
