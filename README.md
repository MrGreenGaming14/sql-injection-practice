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

The instructor key is `answers/instructor_answer_key.md`. It is not linked or served by Flask. GitHub Pages publishes only `static/pages`, which is documentation and explicitly says Flask runs locally.

## Safety

Use only on localhost and only with fictional data. Do not expose the Flask server to a network. Parameterized queries, input validation, least privilege, generic errors, and authorization are the defensive lessons.
