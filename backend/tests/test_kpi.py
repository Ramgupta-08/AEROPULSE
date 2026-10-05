EO = {"X-Role": "engineering_officer"}


def test_overview(fleet_client):
    k = fleet_client.get("/api/kpi/overview", headers=EO).json()
    assert k["ready"] + k["caution"] + k["grounded"] == 60
    assert k["readiness_pct"] == round(100 * (k["ready"] + k["caution"]) / 60, 1)
    assert len(k["readiness_spark"]) >= 10
    assert fleet_client.get("/api/kpi/overview", headers={"X-Role": "technician"}).status_code == 403


def test_forecast_shows_shortfall_under_reactive_plan(fleet_client):
    f = fleet_client.get("/api/forecast?plan=reactive", headers=EO).json()
    fighters = f["types"]["Fighter Type-A"]
    assert len(fighters["p50"]) == 30
    assert all(lo <= mid <= hi for lo, mid, hi in zip(fighters["low"], fighters["p50"], fighters["high"], strict=True))
    assert any(12 <= d <= 15 for d in fighters["shortfall_days"])


def test_top_alert_is_ap112(fleet_client):
    alerts = fleet_client.get("/api/alerts", headers=EO).json()
    assert alerts[0]["tail"] == "AP-112"
    assert len(alerts[0]["also_due"]) == 2
