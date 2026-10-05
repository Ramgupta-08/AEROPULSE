EO = {"X-Role": "engineering_officer"}


def test_optimise_beats_reactive_and_keeps_deadlines(fleet_client):
    r = fleet_client.post("/api/schedule/optimise?mission_aware=true&bundling_window_days=20", headers=EO)
    assert r.status_code == 200
    body = r.json()
    plan, cmp = body["plan"], body["compare"]
    assert plan["status"] in ("OPTIMAL", "FEASIBLE") and plan["solve_seconds"] < 10
    assert plan["late_visits"] == 0
    assert cmp["aeropulse"]["avg_readiness_pct"] > cmp["reactive"]["avg_readiness_pct"]
    assert cmp["aeropulse"]["missions_short"] < cmp["reactive"]["missions_short"]
    ap112 = next(b for b in body["blocks"] if b["tail"] == "AP-112")
    assert len(ap112["tasks"]) == 3 and ap112["bundled_count"] == 2
    assert ap112["start_day"] + ap112["duration_days"] <= 12  # done before Exercise Garuda Shield


def test_forecast_shortfall_removed_by_plan(fleet_client):
    fleet_client.post("/api/schedule/optimise", headers=EO)
    f = fleet_client.get("/api/forecast", headers=EO).json()
    assert f["plan"] == "aeropulse"
    assert not any(12 <= d <= 15 for d in f["types"]["Fighter Type-A"]["shortfall_days"])


def test_move_validates_constraints(fleet_client):
    blocks = fleet_client.post("/api/schedule/optimise", headers=EO).json()["blocks"]
    ap112 = next(b for b in blocks if b["tail"] == "AP-112")
    r = fleet_client.patch(f"/api/schedule/{ap112['id']}", json={"start_day": 25}, headers=EO).json()
    assert not r["applied"] and any(i["type"] == "deadline" for i in r["issues"])
    locked = next(b for b in blocks if b["locked"])
    r = fleet_client.patch(f"/api/schedule/{locked['id']}", json={"start_day": 3, "force": True}, headers=EO).json()
    assert not r["applied"]
    ok = fleet_client.patch(
        f"/api/schedule/{ap112['id']}", json={"start_day": max(2, ap112["start_day"] - 1)}, headers=EO
    ).json()
    assert ok["applied"] or ok["issues"]
    assert fleet_client.post("/api/schedule/optimise", headers={"X-Role": "commander"}).status_code == 403


def test_schedule_read_and_reset(fleet_client):
    assert fleet_client.get("/api/schedule", headers=EO).json()["plan"] is None
    fleet_client.post("/api/schedule/optimise", headers=EO)
    s = fleet_client.get("/api/schedule", headers=EO).json()
    assert s["blocks"] and len(s["dates"]) == 30 and s["bays"]
    assert fleet_client.get("/api/schedule/compare", headers={"X-Role": "commander"}).status_code == 200
    assert fleet_client.post("/api/schedule/reset", headers=EO).json()["removed"] == len(s["blocks"])


def test_whatif_delay_part_shows_transfer_fix(fleet_client):
    r = fleet_client.post(
        "/api/whatif/run",
        json={"actions": [{"type": "delay_part", "part_number": "FA-HYD-02", "days": 10}]},
        headers=EO,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["mitigations"] and "Jodhpur" in body["mitigations"][0]["message"]
    assert body["unmitigated"]["late_visits"] >= body["scenario"]["late_visits"]
    bad = fleet_client.post("/api/whatif/run", json={"actions": [{"type": "nonsense"}]}, headers=EO)
    assert bad.status_code == 422


def test_whatif_scenarios_crud(fleet_client):
    acts = [{"type": "lose_bays", "base_id": "GWL", "count": 2, "start_day": 2, "days": 7}]
    s = fleet_client.post("/api/whatif/scenarios", json={"name": "Bay loss", "actions": acts}, headers=EO).json()
    assert s["result"]["delta"]["downtime_aircraft_days"] >= 0
    assert len(fleet_client.get("/api/whatif/scenarios", headers=EO).json()) == 1
    assert fleet_client.delete(f"/api/whatif/scenarios/{s['id']}", headers=EO).status_code == 200
    assert fleet_client.get("/api/whatif/options", headers=EO).json()["parts"]


def test_missions_and_coverage(fleet_client):
    m = fleet_client.get("/api/missions", headers=EO).json()
    garuda = next(x for x in m["missions"] if x["name"] == "Exercise Garuda Shield")
    assert m["plan"] == "reactive" and garuda["shortfall"] > 0
    c = fleet_client.get(f"/api/missions/{garuda['id']}/coverage", headers=EO).json()
    assert c["supportable"] is False and c["available"] < 30
    assert fleet_client.get("/api/missions/XX/coverage", headers=EO).status_code == 404
