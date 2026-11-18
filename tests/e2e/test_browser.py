"""Browser checks of the web app: every page renders, navigation and the side panel behave, nothing errors.

Runs against a FarmStat server started for the test (or FARMSTAT_E2E_URL if set), using Playwright's Chromium:
    pip install playwright && playwright install chromium
    FARMSTAT_E2E=1 python -m pytest tests/e2e -q
Set CHROME_PATH to use an installed Chrome instead. Skipped unless FARMSTAT_E2E is set, so a plain `pytest tests`
stays fast and needs no browser.
"""
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest

if not os.environ.get("FARMSTAT_E2E"):
    pytest.skip("browser checks run only with FARMSTAT_E2E=1", allow_module_level=True)
sync_api = pytest.importorskip("playwright.sync_api")

ROOT = Path(__file__).resolve().parents[2]


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def base():
    if url := os.environ.get("FARMSTAT_E2E_URL"):
        yield url.rstrip("/") + "/"
        return
    port = _free_port()
    env = {k: v for k, v in os.environ.items() if not k.startswith("SUPABASE")}   # live feed off: weekly data only
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "api.main:app", "--port", str(port)], cwd=ROOT, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://127.0.0.1:{port}/"
    try:
        for _ in range(120):
            try:
                urllib.request.urlopen(url + "api/meta", timeout=2)
                break
            except OSError:
                time.sleep(0.5)
        else:
            pytest.fail("the FarmStat server did not start")
        yield url
    finally:
        proc.terminate()
        proc.wait(10)


@pytest.fixture(scope="module")
def browser():
    with sync_api.sync_playwright() as p:
        b = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None, args=["--no-sandbox"])
        yield b
        b.close()


@pytest.fixture
def page(browser):
    """A fresh page with the welcome notice dismissed; fails the test on any console error or page error."""
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_init_script("try { localStorage.setItem('farmstat-notice-v1', '1') } catch (e) {}")
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    yield pg
    ctx.close()
    assert not errors, errors


def heading(pg) -> str:
    return pg.locator("main h1").first.inner_text()


def no_sideways_scroll(pg) -> bool:
    return pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


def peek(pg) -> str:
    return pg.evaluate("document.querySelector('.side').dataset.peek")


def test_home_is_the_india_overview(page, base):
    page.goto(base)
    page.wait_for_selector(".state-bars")
    assert heading(page) == "Onion across India"
    assert "mandi=" not in page.evaluate("location.hash")   # nothing is chosen for the visitor
    assert no_sideways_scroll(page)


@pytest.mark.parametrize("hash_, ready, title", [
    ("#crop=Onion&view=market&state=Maharashtra&mandi=Lasalgaon", ".chart-panel", "Lasalgaon"),
    ("#crop=Tomato&view=compare&state=Maharashtra", ".table", "Where to sell tomato"),
    ("#crop=Onion&view=accuracy", ".stats", "How accurate is it?"),
    ("#crop=Onion&view=about", ".doc-body", "Mandi prices, a few weeks ahead"),
    ("#crop=Arecanut&view=overview", ".state-bars", "Arecanut across India"),
])
def test_every_page_renders(page, base, hash_, ready, title):
    page.goto(base + hash_)
    page.wait_for_selector(ready)
    assert heading(page) == title
    assert no_sideways_scroll(page)


@pytest.mark.parametrize("hash_", ["#crop=Cashew&view=overview", "#crop=Sugarcane", "#crop=Onion&view=nonsense",
                                   "#crop=Onion&view=market&state=Maharashtra&mandi=Nowhere",
                                   "#crop=Onion&view=overview&state=Atlantis"])
def test_old_or_unknown_links_open_the_overview(page, base, hash_):
    page.goto(base + hash_)
    page.wait_for_selector(".state-bars")
    assert heading(page) == "Onion across India"


def test_compare_lists_every_mandi_in_the_state(page, base):
    page.goto(base + "#crop=Onion&view=compare&state=Maharashtra")
    page.wait_for_selector(".table tbody tr")
    n = len(page.evaluate("fetch('/api/mandis?crop=Onion&state=Maharashtra').then(r => r.json())"))
    assert page.locator(".table tbody tr").count() == n
    page.locator(".cell-link").nth(1).click()
    page.wait_for_selector(".chart-panel")
    assert "view=market" in page.evaluate("location.hash")


def test_side_panel_opens_on_rest_and_closes(page, base):
    page.goto(base)
    page.wait_for_selector(".state-bars")
    page.mouse.move(30, 400)
    page.mouse.move(700, 400)
    page.wait_for_timeout(400)
    assert peek(page) == "false", "a quick pass over the rail must not open the panel"
    page.mouse.move(30, 400)
    page.wait_for_timeout(400)
    assert peek(page) == "true"
    page.mouse.move(900, 400)
    page.wait_for_timeout(600)
    assert peek(page) == "false"
    page.mouse.move(30, 400)
    page.wait_for_timeout(400)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    assert peek(page) == "false"


def test_search_finds_a_mandi_and_cancel_closes(page, base):
    page.goto(base)
    page.wait_for_selector(".state-bars")
    page.keyboard.press("Control+k")
    page.wait_for_selector(".cmdk")
    page.keyboard.type("lasalgaon")
    page.wait_for_selector(".cmdk [role=option]")
    page.click(".cmdk-cancel")
    assert page.locator(".cmdk").count() == 0
    page.keyboard.press("Control+k")
    page.keyboard.type("lasalgaon")
    page.keyboard.press("Enter")
    page.wait_for_selector(".chart-panel")
    assert heading(page).startswith("Lasalgaon")


def test_back_button_stays_in_the_app(page, base):
    page.goto(base)
    page.wait_for_selector(".state-bars")
    page.click("[role=tab]:has-text('Model accuracy')")
    page.wait_for_selector(".stats")
    page.click(".topbar >> text=Tomato")
    page.wait_for_timeout(800)
    page.go_back()
    page.wait_for_timeout(800)
    assert "crop=Onion" in page.evaluate("location.hash") and "view=accuracy" in page.evaluate("location.hash")
    page.go_back()
    page.wait_for_selector(".state-bars")
    assert heading(page) == "Onion across India"


def test_about_hides_the_app_features(page, base):
    page.goto(base + "#crop=Onion&view=about")
    page.wait_for_selector(".doc-body")
    assert page.locator(".side").count() == 0
    page.keyboard.press("Control+k")
    page.wait_for_timeout(300)
    assert page.locator(".cmdk").count() == 0
    page.click("[role=tab]:has-text('India overview')")
    page.wait_for_selector(".state-bars")
    assert page.locator(".side").count() == 1


def test_phone_layout_and_drop_down(browser, base):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    ctx.add_init_script("try { localStorage.setItem('farmstat-notice-v1', '1') } catch (e) {}")
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    try:
        for hash_, ready in [("", ".state-bars"), ("#crop=Onion&view=market&state=Maharashtra&mandi=Lasalgaon", ".chart-panel"),
                             ("#crop=Onion&view=compare&state=Maharashtra", ".table"), ("#crop=Onion&view=accuracy", ".stats")]:
            pg.goto(base + hash_)
            pg.wait_for_selector(ready)
            assert no_sideways_scroll(pg), hash_
        pg.goto(base)
        pg.wait_for_selector(".state-bars")
        pg.tap(".side-toggle")
        assert pg.evaluate("document.querySelector('.side').dataset.open") == "true"
        pg.tap("main h1")
        pg.wait_for_timeout(300)
        assert pg.evaluate("document.querySelector('.side').dataset.open") == "false"
        assert not errors, errors
    finally:
        ctx.close()
