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


def test_home_asks_for_a_crop_first(page, base):
    page.goto(base)
    page.wait_for_selector(".crop-choice")
    assert heading(page) == "Which crop are you selling?"
    assert "crop=" not in page.evaluate("location.hash")   # nothing is chosen for the visitor
    assert page.locator(".crop-pick").count() == 4
    assert page.locator(".side").count() == 0 and page.locator(".search-any").count() == 0   # no crop: nothing to search
    assert [t.inner_text() for t in page.locator("[role=tab]").all()] == ["All crops", "Model accuracy", "About"]
    page.click(".crop-pick:has-text('Tomato')")
    page.wait_for_selector(".state-bars")
    assert heading(page) == "Tomato across India"
    assert "Mandi" not in [t.inner_text() for t in page.locator("[role=tab]").all()]
    page.click(".topbar .brand")
    page.wait_for_selector(".crop-choice")
    assert no_sideways_scroll(page)


@pytest.mark.parametrize("hash_, ready, title", [
    ("#crop=Onion&view=market&state=Maharashtra&mandi=Lasalgaon", ".chart-panel", "Lasalgaon"),
    ("#crop=Tomato&view=compare&state=Maharashtra", ".table", "Where to sell tomato"),
    ("#crop=Onion&view=accuracy", ".stats", "How accurate is it?"),
    ("#crop=Onion&view=about", ".doc-body", "Mandi prices, a few weeks ahead"),
    ("#crop=Arecanut&view=overview", ".state-bars", "Arecanut across India"),
    ("#crop=Arecanut&view=compare&state=Karnataka", ".table", "Where to sell arecanut"),   # no mandi chosen yet
])
def test_every_page_renders(page, base, hash_, ready, title):
    page.goto(base + hash_)
    page.wait_for_selector(ready)
    assert heading(page) == title
    assert no_sideways_scroll(page)


def test_board_figures_roll_to_the_real_value(page, base):
    """The rolling digits end on the same number screen readers are given, on the board and on the home page."""
    for hash_, ready in [("#crop=Onion&view=market&state=Maharashtra&mandi=Lasalgaon", ".chart-panel"), ("", ".crop-choice")]:
        page.goto(base + hash_)
        page.wait_for_selector(ready)
        page.wait_for_timeout(1500)   # the first roll starts when the figure is in view and lasts under a second
        pairs = page.evaluate("""() => [...document.querySelectorAll('.counter')].map(c => [
            c.querySelector('.sr').textContent.replace(/\\D/g, ''),
            [...c.querySelectorAll('.counter__strip')].map(s => s.style.getPropertyValue('--d')).join('')])""")
        assert pairs and all(a == b for a, b in pairs), pairs


@pytest.mark.parametrize("hash_, ready, title", [
    ("#crop=Cashew&view=overview", ".crop-choice", "Which crop are you selling?"),
    ("#crop=Sugarcane", ".crop-choice", "Which crop are you selling?"),
    ("#view=market&state=Maharashtra&mandi=Lasalgaon", ".crop-choice", "Which crop are you selling?"),
    ("#crop=Onion&view=nonsense", ".state-bars", "Onion across India"),
    ("#crop=Onion&view=market&state=Maharashtra&mandi=Nowhere", ".state-bars", "Onion across India"),
    ("#crop=Onion&view=overview&state=Atlantis", ".state-bars", "Onion across India"),
])
def test_old_or_unknown_links_fall_back(page, base, hash_, ready, title):
    page.goto(base + hash_)
    page.wait_for_selector(ready)
    assert heading(page) == title


def test_compare_lists_every_mandi_in_the_state(page, base):
    page.goto(base + "#crop=Onion&view=compare&state=Maharashtra")
    page.wait_for_selector(".table tbody tr")
    n = len(page.evaluate("fetch('/api/mandis?crop=Onion&state=Maharashtra').then(r => r.json())"))
    assert page.locator(".table tbody tr").count() == n
    page.locator(".cell-link").nth(1).click()
    page.wait_for_selector(".chart-panel")
    assert "view=market" in page.evaluate("location.hash")


def test_side_panel_opens_on_rest_and_closes(page, base):
    page.goto(base + "#crop=Onion&view=overview")
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


def test_search_finds_only_the_crops_mandis(page, base):
    page.goto(base + "#crop=Tomato&view=overview")
    page.wait_for_selector(".state-bars")
    page.keyboard.press("Control+k")
    page.wait_for_selector(".cmdk")
    page.keyboard.type("model accuracy")      # pages and other crops are not search results
    page.wait_for_timeout(300)
    assert page.locator(".cmdk [role=option]").count() == 0
    page.fill(".cmdk input", "")
    page.wait_for_selector(".cmdk [role=option]")
    n = len(page.evaluate("fetch('/api/index').then(r => r.json()).then(d => d.rows.filter(r => r[0] === 'Tomato'))"))
    shown = page.locator(".cmdk [role=option]").count()
    assert 0 < shown <= n
    page.keyboard.type("kolar")
    page.keyboard.press("Enter")
    page.wait_for_selector(".chart-panel")
    assert "crop=Tomato" in page.evaluate("location.hash") and "Kolar" in heading(page)


def test_search_finds_a_mandi_and_cancel_closes(page, base):
    page.goto(base + "#crop=Onion&view=overview")
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
    page.wait_for_selector(".crop-choice")
    page.click(".crop-pick:has-text('Onion')")
    page.wait_for_selector(".state-bars")
    page.click(".crops >> text=Tomato")
    page.wait_for_selector("main h1:has-text('Tomato across India')")
    page.click("[role=tab]:has-text('Model accuracy')")
    page.wait_for_selector(".stats")
    page.go_back()
    page.wait_for_selector("main h1:has-text('Tomato across India')")
    assert "crop=Tomato" in page.evaluate("location.hash") and "view=overview" in page.evaluate("location.hash")
    page.go_back()
    page.wait_for_selector("main h1:has-text('Onion across India')")
    page.go_back()
    page.wait_for_selector(".crop-choice")


def test_about_hides_the_app_features(page, base):
    page.goto(base + "#crop=Onion&view=about")
    page.wait_for_selector(".doc-body")
    assert page.locator(".side").count() == 0
    page.keyboard.press("Control+k")
    page.wait_for_timeout(300)
    assert page.locator(".cmdk").count() == 0
    page.click("[role=tab]:has-text('All crops')")
    page.wait_for_selector(".crop-choice")
    page.click(".crop-pick:has-text('Onion')")
    page.wait_for_selector(".state-bars")
    assert page.locator(".side").count() == 1


def test_phone_layout_and_drop_down(browser, base):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    ctx.add_init_script("try { localStorage.setItem('farmstat-notice-v1', '1') } catch (e) {}")
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    try:
        for hash_, ready in [("", ".crop-choice"), ("#crop=Onion&view=overview", ".state-bars"),
                             ("#crop=Onion&view=market&state=Maharashtra&mandi=Lasalgaon", ".chart-panel"),
                             ("#crop=Onion&view=compare&state=Maharashtra", ".table"), ("#crop=Onion&view=accuracy", ".stats")]:
            pg.goto(base + hash_)
            pg.wait_for_selector(ready)
            assert no_sideways_scroll(pg), hash_
        pg.goto(base + "#crop=Onion&view=overview")
        pg.wait_for_selector(".state-bars")
        pg.tap(".side-toggle")
        assert pg.evaluate("document.querySelector('.side').dataset.open") == "true"
        pg.tap("main h1")
        pg.wait_for_timeout(300)
        assert pg.evaluate("document.querySelector('.side').dataset.open") == "false"
        assert not errors, errors
    finally:
        ctx.close()


def test_chart_hover_shows_the_week(page, base):
    page.goto(base + "#crop=Onion&view=market&state=Maharashtra&mandi=Lasalgaon")
    page.wait_for_selector(".pchart svg")
    page.evaluate("document.querySelector('.pchart').scrollIntoView({block: 'center'})")
    box = page.locator(".pchart svg").bounding_box()
    page.mouse.move(box["x"] + box["width"] * 0.5, box["y"] + 120)
    page.wait_for_selector(".pchart-tip")
    assert "Week of" in page.inner_text(".pchart-tip")
    page.mouse.move(box["x"] + box["width"] * 0.5, box["y"] - 60)   # leaving the chart hides it
    page.wait_for_timeout(200)
    assert page.locator(".pchart-tip").count() == 0
