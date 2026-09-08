"""Static checks for the GitHub Pages browser simulation in static/pages.

These checks run without a browser: they verify the challenge files exist,
the pinned sql.js CDN + locateFile wiring is present, all four levels are
represented, answer payloads never leak into the published pages, and the
Pages workflow still publishes only static/pages.
"""

import re
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
PAGES_DIR = BASE_DIR / "static" / "pages"
WORKFLOW = BASE_DIR / ".github" / "workflows" / "pages.yml"

LEVELS = ("login", "search", "account-lookup", "transfer")

# Authorized classroom payloads from answers/instructor_answer_key.md. These
# must never appear in the published Pages sources (directions, hints, code).
ANSWER_PAYLOADS = (
    "' OR '1'='1' --",
    "' UNION SELECT username,password,'x' FROM users --",
    "10001' OR '1'='1",
    "1 OR 1=1",
)


def challenge_html() -> str:
    return (PAGES_DIR / "challenge.html").read_text(encoding="utf-8")


def challenge_js() -> str:
    return (PAGES_DIR / "challenge.js").read_text(encoding="utf-8")


def test_challenge_assets_exist():
    for name in ("challenge.html", "challenge.js", "challenge.css"):
        assert (PAGES_DIR / name).is_file(), f"missing static/pages/{name}"


def test_challenge_uses_pinned_sqljs_cdn_with_locatefile():
    js = challenge_js()
    pinned = re.findall(r"sql\.js@(\d+\.\d+\.\d+)/", js)
    assert pinned, "challenge.js must reference a pinned sql.js CDN version"
    assert len(set(pinned)) == 1, "all sql.js references must pin one version"
    assert "cdn.jsdelivr.net/npm/sql.js@" in js
    assert "locateFile" in js
    assert "sql-wasm.js" in js and "sql-wasm" in js


def test_all_four_levels_represented_in_page_and_script():
    html = challenge_html()
    js = challenge_js()
    for level in LEVELS:
        assert f'data-level="{level}"' in html, f"level {level} missing from challenge.html"
        assert f'"{level}"' in js, f"level {level} missing from challenge.js"


def test_answer_payloads_absent_from_published_sources():
    html = challenge_html()
    js = challenge_js()
    for payload in ANSWER_PAYLOADS:
        assert payload not in html, f"answer payload leaked into challenge.html: {payload!r}"
        assert payload not in js, f"answer payload leaked into challenge.js: {payload!r}"


def test_progressive_hints_defined_for_every_level():
    js = challenge_js()
    hints_match = re.search(r"const HINTS = \{(.*?)\n\};", js, re.DOTALL)
    assert hints_match, "challenge.js must define a HINTS object"
    hints_block = hints_match.group(1)
    for level in LEVELS:
        assert f'"{level}":' in hints_block or f"{level}:" in hints_block
    assert hints_block.count('"') >= len(LEVELS) * 3 * 2, "each level needs at least three hints"


def test_asset_urls_are_relative_and_pages_links_exist():
    html = challenge_html()
    index = (PAGES_DIR / "index.html").read_text(encoding="utf-8")
    assert 'href="./challenge.css"' in html
    assert 'src="./challenge.js"' in html
    assert 'href="./index.html"' in html
    assert 'href="./challenge.html"' in index
    # No server-absolute local asset paths anywhere in the Pages artifact.
    for source in (html, index):
        assert 'href="/' not in source
        assert 'src="/' not in source


def test_index_html_explains_both_modes():
    index = (PAGES_DIR / "index.html").read_text(encoding="utf-8").lower()
    assert "browser" in index and "flask" in index
    assert "sql.js" in index
    assert "192.0.2.42" in index


def test_pages_workflow_publishes_only_static_pages():
    workflow = WORKFLOW.read_text(encoding="utf-8")
    assert "path: static/pages" in workflow
    for forbidden in ("answers", "app.py", "templates", "secret_files", "lab.sqlite3"):
        assert forbidden not in workflow, f"workflow must not publish {forbidden}"


def test_answer_key_not_present_in_pages_artifact():
    published = [path for path in PAGES_DIR.rglob("*") if path.is_file()]
    assert published, "static/pages must not be empty"
    for path in published:
        assert "instructor_answer_key" not in path.name
        assert path.suffix != ".md"
    for path in published:
        assert "instructor_answer_key" not in path.read_text(encoding="utf-8", errors="replace")


def test_challenge_avoids_innerhtml_and_document_write():
    js = challenge_js()
    assert "innerHTML" not in js
    assert "document.write" not in js
    assert "outerHTML" not in js


def test_challenge_includes_reset_and_simulated_soc_markers():
    js = challenge_js()
    html = challenge_html()
    assert 'data-role="reset-lab"' in html
    assert "192.0.2.42" in js and "192.0.2.42" in html
    assert "TEST-NET-1" in html
    assert 'data-secret="super_secret_soc_report.txt"' in html
