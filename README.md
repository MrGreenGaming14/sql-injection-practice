# Horizon Community Savings SQL Injection Lab

Intentionally vulnerable, fictional Flask training software for local classrooms. It uses SQLite and must not be deployed remotely. There are no real credentials, funds, or customer records.

## Run locally

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
flask --app app run --host 127.0.0.1
```

Open `http://127.0.0.1:5000`. The four levels unlock sequentially. Reset clears only the current browser session's progress and hint counters; it does not reset the database. Level 4 only reads data and simulates a transfer, so students share no permanent state. The login query intentionally uses raw string concatenation, clearly marked in `app.py`; never copy that pattern into production.

Secret files are available only through the allow-listed training route. Traversal and source/database/environment files are not exposed. Every access emits a structured server log with timestamp, filename, route, method, and `request.remote_addr`, and the JSON response includes an event for `static/js/soc-monitor.js`. Server logs are authoritative; the browser alert is classroom convenience only.

The instructor key is `answers/instructor_answer_key.md`. It is not linked or served by Flask. GitHub Pages publishes only `static/pages`, which is documentation plus the browser simulation, and explicitly says Flask runs locally.

## GitHub Pages browser simulation

`static/pages/challenge.html` is a static, browser-only version of the same four-level lab. Open it from the GitHub Pages URL (for example `https://<org>.github.io/sql-injection-practice/challenge.html`, linked from `index.html`) or directly from disk — no build step.

- The SQLite engine is [sql.js](https://sql.js.org/), pinned to `1.13.0` on jsDelivr with a cdnjs fallback, and the matching `sql-wasm.wasm` is resolved with `locateFile`. An internet connection is needed the first time the engine loads; if both CDNs are unreachable the page shows a clear error instead of a broken lab.
- The database is created in memory inside the browser tab from the same fictional data as `schema.sql`/`seed_data.py`. Nothing is uploaded, no Python or server runs, and the database is rebuilt on every reload. Progress and hint counters live only in `localStorage`; Reset lab clears them.
- The SOC panel fabricates clearly-labeled fictional events using `192.0.2.42` (TEST-NET-1 documentation range) and prints a console warning. GitHub Pages serves static files only: it cannot know the real client IP address, so the panel is explicitly not a real server-side IP log.
- Differences from the local Flask lab: the transfer level only reads from the in-memory database (nothing to roll back), secret-file access is simulated instead of routed through Flask, and no server logs exist. The two modes share no state.
- The published artifact contains only `static/pages`. The Flask app, its templates, and `answers/instructor_answer_key.md` are never published.

## Safety

Use only on localhost and only with fictional data. Do not expose the Flask server to a network. Parameterized queries, input validation, least privilege, generic errors, and authorization are the defensive lessons.
