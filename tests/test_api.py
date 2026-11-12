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
