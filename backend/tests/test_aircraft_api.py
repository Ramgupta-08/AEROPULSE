EO = {"X-Role": "engineering_officer"}


def test_fleet_list_and_role(fleet_client):
    rows = fleet_client.get("/api/aircraft", headers=EO).json()
    assert len(rows) == 60
    assert {r["status"] for r in rows} == {"ready", "caution", "grounded"}
    assert fleet_client.get("/api/aircraft", headers={"X-Role": "auditor"}).status_code == 403


def test_detail_twin_and_component(fleet_client):
    d = fleet_client.get("/api/aircraft/AP-112", headers=EO).json()
    assert d["type"] == "Fighter Type-A" and d["base_id"] == "GWL"
    past = fleet_client.get("/api/aircraft/AP-112/twin?day_offset=-90", headers=EO).json()
    future = fleet_client.get("/api/aircraft/AP-112/twin?day_offset=60", headers=EO).json()
    assert past["health"] > future["health"]
    e2 = next(c for c in d["components"] if c["position"] == "Engine 2")
    det = fleet_client.get(f"/api/aircraft/AP-112/components/{e2['id']}", headers=EO).json()
    assert det["reasons"] and det["history"] and det["rul_label"].endswith(")")
    hyd = next(c for c in d["components"] if c["kind"] == "hydraulics")
    det = fleet_client.get(f"/api/aircraft/AP-112/components/{hyd['id']}", headers=EO).json()
    assert det["batch"] == "HS-2291" and det["bad_batch"]
    assert fleet_client.get("/api/aircraft/AP-999", headers=EO).status_code == 404


def test_series(fleet_client):
    s = fleet_client.get("/api/aircraft/AP-112/twin/series", headers=EO).json()
    assert len(s["offsets"]) == len(s["aircraft"]) == 31


def test_telemetry_stream(fleet_client):
    with fleet_client.websocket_connect("/ws/telemetry/AP-112?role=technician") as ws:
        meta = ws.receive_json()
        assert meta["type"] == "meta" and meta["engines"] == ["Engine 1", "Engine 2"]
        frame = ws.receive_json()
        assert set(frame["engines"]["Engine 2"]) == {"egt", "n1", "n2", "fuel_flow", "vibration", "oil_pressure"}
