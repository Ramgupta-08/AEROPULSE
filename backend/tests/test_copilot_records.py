EO = {"X-Role": "engineering_officer"}
TECH = {"X-Role": "technician"}
AUD = {"X-Role": "auditor"}


def test_copilot_retrieval_answer_offline(fleet_client, monkeypatch):
    import dataclasses

    from app.services import copilot

    monkeypatch.setattr(copilot, "settings", dataclasses.replace(copilot.settings, anthropic_api_key=None))
    r = fleet_client.post(
        "/api/copilot/ask", json={"question": "hydraulic pressure dropping on left side after landing"}, headers=TECH
    )
    assert r.status_code == 200
    a = r.json()
    assert a["mode"] == "retrieval"
    assert a["manual"][0]["ref"] == "GMM 29-10"
    assert a["causes"] and a["cases"] and a["cases"][0]["id"] == "C1" and a["cases"][0]["record_id"]
    assert "Likely causes" in a["answer"]
    hinglish = fleet_client.post(
        "/api/copilot/ask", json={"question": "APU start nahi ho raha thand me"}, headers=TECH
    ).json()
    assert hinglish["manual"][0]["ref"] == "GMM 49-10"
    assert (
        fleet_client.post("/api/copilot/ask", json={"question": "x y z"}, headers={"X-Role": "logistics"}).status_code
        == 403
    )


def test_logbook_insights_discover_planted_patterns(fleet_client):
    d = fleet_client.get("/api/logbook/insights", headers=TECH).json()
    text = " ".join(i["message"] for i in d["insights"])
    assert "HS-2291" in text
    assert "APU start failure at Leh" in text
    assert "corrosion at Jamnagar" in text
    assert len(d["themes"]) >= 8 and len(d["months"]) == 12


def test_voice_entry_parse_and_signed_save(fleet_client):
    draft = fleet_client.post(
        "/api/logbook/parse",
        json={"text": "AP-112 left side hydraulic pressure drop after landing, seal kit badla"},
        headers=TECH,
    ).json()
    assert (
        draft["tail"] == "AP-112"
        and draft["component_kind"] == "hydraulics"
        and draft["defect_code"] == "HYD-LKS"
        and draft["action"] == "replaced"
    )
    r = fleet_client.post(
        "/api/logbook/entry",
        headers=TECH,
        json={
            "tail": "AP-112",
            "component_kind": "hydraulics",
            "defect_code": "HYD-LKS",
            "narrative": draft["narrative"],
            "action_taken": "Seal kit replaced, leak check OK",
            "man_hours": 3,
            "parts_used": ["FA-HYD-02"],
        },
    )
    assert r.status_code == 200 and len(r.json()["hash"]) == 64
    assert fleet_client.get("/api/records/verify", headers=AUD).json()["ok"]


def test_part_lookup(fleet_client):
    parts = fleet_client.get("/api/parts?tail=AP-112", headers=TECH).json()
    assert len(parts) == 9
    h = fleet_client.get(f"/api/parts/{parts[0]['serial']}", headers=TECH).json()
    assert h["tail"] == "AP-112" and "records" in h
    assert fleet_client.get("/api/parts/NOPE-1", headers=TECH).status_code == 404


def test_tamper_detected_and_restored(fleet_client):
    assert fleet_client.get("/api/records/verify", headers=AUD).json()["ok"]
    t = fleet_client.post("/api/records/tamper", headers=AUD).json()
    v = fleet_client.get("/api/records/verify", headers=AUD).json()
    assert not v["ok"] and v["broken"][0]["entity_id"] == str(t["record_id"]) and v["tamper_demo_active"]
    assert fleet_client.post("/api/records/tamper", headers=AUD).status_code == 409
    fleet_client.post("/api/records/restore", headers=AUD)
    assert fleet_client.get("/api/records/verify", headers=AUD).json()["ok"]
    assert fleet_client.get("/api/records/verify", headers=TECH).status_code == 403


def test_audit_filters(fleet_client):
    all_ = fleet_client.get("/api/audit?limit=5", headers=AUD).json()
    assert all_["total"] >= 3000 and len(all_["items"]) == 5
    wo = fleet_client.get("/api/audit?action=workorder.open", headers=AUD).json()
    assert wo["total"] == 16
    assert fleet_client.get("/api/audit?tail=AP-112", headers=AUD).json()["total"] > 0


def test_datahub_sources_and_upload(fleet_client):
    s = fleet_client.get("/api/datahub/sources", headers=EO).json()
    assert [x["name"] for x in s["sources"]] == [
        "Health Monitoring",
        "Technical Records",
        "Spares",
        "Maintenance Agencies",
    ]
    tmpl = fleet_client.get("/api/datahub/template", headers=EO).text
    files = {"file": ("records.csv", tmpl.encode(), "text/csv")}
    dry = fleet_client.post("/api/datahub/upload", files=files, data={"dry_run": "true"}, headers=EO).json()
    assert dry["mapping"]["tail"] == "Tail No" and dry["valid"] == 2 and dry["invalid"] == 1 and dry["imported"] == 0
    real = fleet_client.post(
        "/api/datahub/upload",
        files={"file": ("records.csv", tmpl.encode(), "text/csv")},
        data={"dry_run": "false", "mapping": __import__("json").dumps(dry["mapping"])},
        headers=EO,
    ).json()
    assert real["imported"] == 2
    assert fleet_client.get("/api/records/verify", headers=EO).json()["ok"]


def test_reports(fleet_client):
    k = fleet_client.get("/api/reports/kpis", headers={"X-Role": "commander"}).json()
    assert k["downtime_avoided_aircraft_days"] > 0 and k["prediction"]["rmse"]
    pdf = fleet_client.get("/api/reports/brief.pdf", headers={"X-Role": "commander"})
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    csv = fleet_client.get("/api/reports/export.csv?dataset=fleet", headers={"X-Role": "commander"})
    assert csv.text.startswith("tail,type") and csv.text.count("\n") == 61
    assert fleet_client.get("/api/reports/kpis", headers=TECH).status_code == 403
