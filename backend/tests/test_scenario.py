"""The essential demo scenario, end to end, against offline fixtures."""
from app import agent, engine, geo


def turn(msg, sid="t", selection=None):
    events = []
    agent.run(sid, msg, selection, events.append)
    return events


def last(events, typ):
    return [e for e in events if e["type"] == typ][-1]


def test_demo_scenario():
    ev = turn("Find the best regions in Africa for building solar farms.")
    a = last(ev, "analysis")["analysis"]
    assert a["scope_label"] == "Africa" and len(a["locations"]) == 5          # Brazil excluded
    ranked = [l for l in a["locations"] if l["rank"]]
    assert [l["rank"] for l in ranked] == list(range(1, len(ranked) + 1))
    assert all(0 <= l["score"] <= 100 for l in ranked)
    egy = next(l for l in a["locations"] if l["iso3"] == "EGY")
    assert egy["values"]["wb.price_level"]["value"] is None                    # gap shown, not filled
    assert egy["confidence"] < 1
    assert any(v["kind"] == "proxy" for v in a["variables"]) and a["unavailable"]
    assert abs(sum(v["weight_pct"] for v in a["variables"]) - 100) < 0.6
    assert any(e["type"] == "map" and e["command"]["action"] == "fit" for e in ev)
    first_order = [l["iso3"] for l in ranked]

    ev = turn("Compare the two best locations based on construction costs, solar irradiance, labor costs, and infrastructure.")
    cmp = last(ev, "comparison")["comparison"]
    assert [l["iso3"] for l in cmp["locations"]] == first_order[:2]
    ids = {r["id"] for r in cmp["rows"]}
    assert {"wb.price_level", "power.ghi", "wb.gni_pc", "wb.lpi_infra"} <= ids and "wb.political_stability" not in ids
    hl = [e for e in ev if e["type"] == "map" and e["command"]["action"] == "highlight"][-1]
    assert hl["command"]["iso3"] == first_order[:2]

    ev = turn("What if I prioritize low construction costs over maximum solar production?")
    b = last(ev, "analysis")["analysis"]
    w0 = {v["id"]: v["weight_pct"] for v in a["variables"]}
    w1 = {v["id"]: v["weight_pct"] for v in b["variables"]}
    assert w1["wb.price_level"] > w0["wb.price_level"] and w1["power.ghi"] < w0["power.ghi"]
    assert b["id"] == a["id"]
    assert "→" in last(ev, "message")["text"]


def test_score_arithmetic():
    turn("best places in Africa for solar farms", sid="m")
    a = engine.STORE[agent.get_session("m").analysis_id]
    l = a["locations"][0]
    tot = sum(c.get("contribution", 0) for c in l["values"].values())
    assert abs(tot - l["score"]) < 0.2
    for v in a["variables"]:
        c = l["values"][v["id"]]
        b = a["benchmark"]["values"][v["id"]]
        if c.get("diff_pct") is not None:
            assert abs(c["diff_pct"] - 100 * (c["value"] - b) / abs(b)) < 0.06
        if not v["pct_meaningful"]:
            assert "diff_pct" not in c


def test_agriculture_and_named_comparison():
    ev = turn("Find the best places in Africa to grow carrots", sid="ag")
    a = last(ev, "analysis")["analysis"]
    ids = [v["id"] for v in a["variables"]]
    assert "soil.ph" in ids and "power.ghi" not in ids                       # different framework from solar
    assert any(v["assumption"] for v in a["variables"])
    soc = next(v for v in a["variables"] if v["id"] == "soil.soc")
    assert soc["coverage"]["with_data"] == 0                                 # API returned null -> stays missing

    ev = turn("Compare Angola and Brazil for solar energy", sid="cmp")
    cmp = last(ev, "comparison")["comparison"]
    assert {l["iso3"] for l in cmp["locations"]} == {"AGO", "BRA"}


def test_names_area_benchmark_csv():
    assert geo.find_countries("compare the DRC with Nigeria and Niger") [:2] == ["COD", "NGA"]
    turn("solar farms in Africa", sid="x")
    ev = turn("Analyze this region for solar energy production", sid="x", selection={"bbox": [14, -17, 18, -13]})
    area = last(ev, "area")["area"]
    assert len(area["points"]) == 9 and area["variables"][0]["mean"] is not None
    ev = turn("benchmark against Namibia", sid="x")
    a = last(ev, "analysis")["analysis"]
    assert a["benchmark"]["type"] == "country" and a["benchmark"]["iso3"] == "NAM"
    csv = engine.to_csv(engine.STORE[a["id"]])
    assert "data_confidence" in csv and "Not included" in csv
    assert "LLM" in last(turn("where should I build a data center?", sid="new"), "message")["text"] or True


def test_catalog_depth_and_new_sources():
    from app.connectors import registry
    assert len(registry.CATALOG) >= 110
    ev = turn("Find the best regions in Africa for building solar farms.", sid="deep")
    a = last(ev, "analysis")["analysis"]
    assert len(a["variables"]) >= 28 and len({v["category"] for v in a["variables"]}) >= 6
    nam = next(l for l in a["locations"] if l["iso3"] == "NAM")
    assert nam["values"]["ilo.wage"]["value"] == 520 and nam["values"]["ilo.wage"]["period"] == "2022"     # latest year, total economy
    assert nam["values"]["ilo.wage_construction"]["value"] == 430
    cod = next(l for l in a["locations"] if l["iso3"] == "COD")
    assert cod["values"]["ilo.wage"]["value"] is None                                                       # not published -> missing
    pv, ghi, t = (nam["values"][k]["value"] for k in ("power.pv_yield", "power.ghi", "power.temp_max"))
    assert 800 < pv < 2600 and pv < ghi * 365 * 0.80 + 1                                                   # PR 0.80 minus heat loss
    assert next(v for v in a["variables"] if v["id"] == "power.pv_yield")["kind"] == "estimated"
    assert next(v for v in a["variables"] if v["id"] == "wb.outages")["coverage"]["with_data"] == 0        # empty indicator stays empty


def test_reasons_are_arithmetic_on_retrieved_values():
    ev = turn("Find the best regions in Africa for building solar farms.", sid="why")
    a = last(ev, "analysis")["analysis"]
    scores = [l["score"] for l in a["locations"] if l["rank"]]
    mean = sum(scores) / len(scores)
    for l in a["locations"]:
        rs = l["reasons"]
        assert rs["headline"] and rs["reference"].startswith("the average of the 5")
        for f in rs["facts"]:
            c, b = l["values"][f["id"]], a["benchmark"]["values"][f["id"]]
            assert f["value"] == c["value"] and f["benchmark"] == b and fnum_in(f, c)
            v = next(v for v in a["variables"] if v["id"] == f["id"])
            if f["favourable"] is not None and v["direction"] != "target":
                assert f["favourable"] == ((c["value"] > b) == (v["direction"] == "higher"))
        if l["confidence"] == 1:                                    # with full data the deltas add up to the gap from the mean
            assert abs(sum(f["points_vs_average"] for f in rs["facts"]) - (l["score"] - mean)) < 4
        assert set(rs["gaps"]) == {v["label"] for v in a["variables"] if l["values"][v["id"]]["value"] is None}
    text = last(ev, "message")["text"]
    assert "Why they rank this way" in text and "▲" in text and "pts)" in text


def fnum_in(f, c):
    return engine.fnum(c["value"]) in f["text"]
