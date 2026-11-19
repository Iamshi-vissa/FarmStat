"""Web API checks: the search index, and input validation in front of the live feed."""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from api import livefeed  # noqa: E402
from api.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_index_lists_every_series(client):
    meta = client.get("/api/meta").json()
    ix = client.get("/api/index").json()
    assert ix["columns"] == ["crop", "state", "market", "district", "price"]
    weekly = sum(c["series"] for c in meta["crops"] if c["kind"] == "weekly")
    assert len(ix["rows"]) == weekly
    assert all(r[4] is None or r[4] > 0 for r in ix["rows"])


def test_live_rejects_unknown_mandi_without_calling_supabase(client, monkeypatch):
    called = []
    monkeypatch.setattr(livefeed, "_get", lambda *a, **k: called.append(a) or [])
    r = client.get("/api/live", params={"crop": "Onion", "state": "Maharashtra", "market": "x) or (1=1"})
    assert r.status_code == 404 and not called
    r = client.get("/api/live", params={"crop": "Onion", "state": "Maharashtra", "market": "Lasalgaon"})
    assert r.status_code == 200 and called


def test_live_cache_is_bounded(monkeypatch):
    class Resp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return b"[]"
    monkeypatch.setattr(livefeed.urllib.request, "urlopen", lambda *a, **k: Resp())
    monkeypatch.setattr(livefeed, "MAX_CACHE", 5)
    livefeed._cache.clear()
    for i in range(12):
        livefeed._get("daily_prices", {"market": f"eq.m{i}"})
    assert len(livefeed._cache) == 5


def test_overview_summarises_a_crop_without_choosing_a_mandi(client):
    d = client.get("/api/overview", params={"crop": "Onion"}).json()
    assert d["series"] > 0 and d["median"] > 0 and d["states"]
    assert sum(s["mandis"] for s in d["states"]) <= d["series"]
    assert d["rises"][0]["move"] >= d["rises"][-1]["move"]          # sorted, biggest expected rise first
    assert d["falls"][0]["move"] <= d["falls"][-1]["move"]
    # the trend and "last week" are the same statistic as the headline median, so the line ends on the big number
    assert d["trend"][-1]["price"] == round(d["median"]) and d["median_prev"] == d["trend"][-2]["price"]
    assert client.get("/api/overview", params={"crop": "Wheat"}).status_code == 404


def test_web_app_route_never_serves_files_outside_dist(client):
    for path in ["/../api/service.py", "/..%2Fapi%2Fservice.py", "/%2e%2e/requirements.txt"]:
        r = client.get(path)
        assert "FarmData" not in r.text and "fastapi" not in r.text


def test_unknown_api_path_is_404(client):
    for path in ("/api/cashew", "/api/sugarcane", "/api/national?crop=Onion", "/api/nope"):
        assert client.get(path).status_code == 404, path


def test_accuracy_payload(client):
    a = client.get("/api/accuracy").json()
    assert set(a["horizons"]) == {"1", "2", "4"}
    assert all(0 < h["MAE_Rs"] < h["naive_MAE_Rs"] * 1.5 for h in a["horizons"].values())
    assert a["test_years"][0] <= a["test_years"][-1]


def test_meta_lists_weekly_crops_only(client):
    assert [c["id"] for c in client.get("/api/meta").json()["crops"]] == ["Onion", "Tomato", "Potato", "Arecanut"]
