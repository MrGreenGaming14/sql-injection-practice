import json
import logging
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, abort, g, jsonify, redirect, render_template, request, session, url_for

BASE_DIR = Path(__file__).resolve().parent
DATABASE = os.environ.get("LAB_DATABASE", str(BASE_DIR / "lab.sqlite3"))
SECRET_DIR = BASE_DIR / "secret_files"
LEVELS = ("login", "search", "account-lookup", "transfer")
HINTS = {
    "login": ["Inspect how the username reaches the SQL statement.", "Ask what a true condition could do to a WHERE clause.", "Try changing the logic of the WHERE clause without changing the password."],
    "search": ["The result has three displayed columns.", "UNION queries need compatible column counts and types.", "Think about selecting a different table with the same number of columns."],
    "account-lookup": ["Compare the messages for an existing and unknown account.", "A boolean condition can be added to an account number.", "Use logic that is true for every row, while keeping the query one statement."],
    "transfer": ["The account identifier is inserted as a numeric expression.", "This exercise simulates a transaction and never commits it.", "A numeric boolean condition can change which account is selected."],
}
INTRODUCTIONS = {
    "login": [
        "Goal: learn how login fields can change the logic of a database WHERE clause.",
        "Investigate both the username and password fields. Start with the normal training credentials and another ordinary, incorrect attempt.",
        "Normally, valid credentials are accepted and invalid credentials fail. Pay attention if unusual input changes that expected behavior.",
        "Success looks like a login being accepted and the next level becoming available.",
        "Use these experiments only in this local fictional lab, never on a real service.",
    ],
    "search": [
        "Goal: learn how a search query is structured and why a UNION needs compatible result columns.",
        "Investigate the search term and the shape of the catalog results, including how many columns are displayed.",
        "Normally, a matching term returns product rows and an unmatched term returns little or nothing. Unusual input may add rows with a different-looking shape.",
        "Success looks like extra result rows appearing and the account-lookup level becoming available.",
        "Use these experiments only in this local fictional lab, never on a real service.",
    ],
    "account-lookup": [
        "Goal: learn boolean inference by comparing how a database responds to true and false account lookups.",
        "Investigate the account number field. Compare an existing account, an unknown account, and carefully varied boolean logic.",
        "Normally, one known account matches and an unknown account does not. An unusual input can change whether the response behaves as TRUE or FALSE and may return more rows.",
        "Success looks like a true-condition response that demonstrates the lookup changed and unlocks the transfer simulator.",
        "Use these experiments only in this local fictional lab, never on a real service.",
    ],
    "transfer": [
        "Goal: learn how numeric input can affect which account a query selects.",
        "Investigate the source account field as well as the destination and amount fields. Destination and amount are classroom simulation fields; no money moves.",
        "Normally, a numeric source selects one account or no account. Unusual numeric input may select a different or broader set of candidate rows.",
        "Success looks like a candidate source being selected, an explicit no-money-moved message, and the final level completing.",
        "Use these experiments only in this local fictional lab, never on a real service.",
    ],
}


def create_app(test_config=None):
    app = Flask(__name__)
    app.config.from_mapping(SECRET_KEY=os.environ.get("LAB_SECRET_KEY", "local-training-key"), DATABASE=DATABASE)
    if test_config:
        app.config.update(test_config)

    def get_db():
        if "db" not in g:
            g.db = sqlite3.connect(app.config["DATABASE"])
            g.db.row_factory = sqlite3.Row
        return g.db

    app.get_db = get_db

    @app.teardown_appcontext
    def close_db(_error=None):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    def init_db():
        db = get_db()
        schema = (BASE_DIR / "schema.sql").read_text(encoding="utf-8")
        db.executescript(schema)
        if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
            seed = (BASE_DIR / "seed_data.py").read_text(encoding="utf-8")
            # seed_data.py contains data only; executing it here keeps setup dependency-free.
            namespace = {"db": db}
            exec(compile(seed, "seed_data.py", "exec"), namespace)
        db.commit()

    with app.app_context():
        init_db()

    def progress():
        completed = session.setdefault("completed", [])
        return {"completed": completed, "current": len(completed) + 1}

    def unlocked(level):
        index = LEVELS.index(level)
        return index == 0 or LEVELS[index - 1] in session.get("completed", [])

    def next_level(level):
        index = LEVELS.index(level) + 1
        return LEVELS[index] if index < len(LEVELS) else None

    level_endpoints = {"login": "login", "search": "search", "account-lookup": "account_lookup", "transfer": "transfer"}

    def fail(level):
        attempts = session.setdefault("attempts", {})
        attempts[level] = attempts.get(level, 0) + 1
        session.modified = True
        return HINTS[level][: min(attempts[level], len(HINTS[level]))]

    def complete(level):
        completed = session.setdefault("completed", [])
        if level not in completed:
            completed.append(level)
        session.modified = True

    @app.context_processor
    def inject_progress():
        return {"levels": LEVELS, "completed": session.get("completed", []), "unlocked": unlocked, "level_endpoints": level_endpoints}

    @app.route("/")
    def home():
        return render_template("home.html", progress=progress())

    @app.route("/reset", methods=("GET", "POST"))
    def reset():
        session.clear()
        if request.method == "POST":
            return redirect(url_for("home"))
        return render_template("reset.html")

    @app.route("/login", methods=("GET", "POST"))
    def login():
        if request.method == "GET":
            return render_template("level.html", level="login", title="Level 1: Sign-in", prompt="Sign in as a training user", fields=["username", "password"], directions=INTRODUCTIONS["login"], show_training_credentials=True)
        username = request.form.get("username", "")
        password = request.form.get("password", "")
        # INTENTIONAL VULNERABILITY: raw string concatenation demonstrates authentication bypass.
        query = "SELECT username FROM users WHERE username = '" + username + "' AND password = '" + password + "'"
        try:
            row = get_db().execute(query).fetchone()
        except sqlite3.Error:
            row = None
        if row:
            complete("login")
            return render_template("result.html", title="Login accepted", message=f"Welcome, {row['username']}. Level complete.", level="login", next_level=next_level("login"), success=True)
        hints = fail("login")
        return render_template("level.html", level="login", title="Level 1: Sign-in", prompt="Try the training sign-in", fields=["username", "password"], directions=INTRODUCTIONS["login"], error="That sign-in did not work.", hints=hints, show_training_credentials=True)

    @app.route("/search", methods=("GET", "POST"))
    def search():
        if not unlocked("search"):
            return redirect(url_for("login"))
        if request.method == "GET":
            return render_template("level.html", level="search", title="Level 2: Catalog search", prompt="Search the public catalog", fields=["term"], directions=INTRODUCTIONS["search"])
        term = request.form.get("term", "")
        query = "SELECT name, category, description FROM products WHERE name LIKE '%" + term + "%'"
        try:
            rows = get_db().execute(query).fetchall()
        except sqlite3.Error:
            rows = []
        is_union = "union" in term.lower() and rows
        if is_union:
            complete("search")
        else:
            hints = fail("search")
            return render_template("level.html", level="search", title="Level 2: Catalog search", prompt="Search the public catalog", fields=["term"], directions=INTRODUCTIONS["search"], rows=rows, error="No training objective detected yet.", hints=hints)
        return render_template("result.html", title="Search results", message="The UNION lesson is complete. Notice the extra rows.", rows=rows, level="search", next_level=next_level("search"), success=True)

    @app.route("/account-lookup", methods=("GET", "POST"))
    def account_lookup():
        if not unlocked("account-lookup"):
            return redirect(url_for("search"))
        if request.method == "GET":
            return render_template("level.html", level="account-lookup", title="Level 3: Account lookup", prompt="Enter an account number", fields=["account_number"], directions=INTRODUCTIONS["account-lookup"])
        value = request.form.get("account_number", "")
        query = "SELECT account_number, owner, balance FROM accounts WHERE account_number = '" + value + "'"
        try:
            rows = get_db().execute(query).fetchall()
        except sqlite3.Error:
            rows = []
        if rows:
            message = "Account match: the condition evaluated TRUE."
        else:
            message = "No account match: the condition evaluated FALSE."
        if rows and (" or " in value.lower() or " and " in value.lower()):
            complete("account-lookup")
            return render_template("result.html", title="Boolean result", message=message + " Level complete.", rows=rows, level="account-lookup", next_level=next_level("account-lookup"), success=True)
        hints = fail("account-lookup")
        return render_template("result.html", title="Boolean result", message=message, rows=rows, level="account-lookup", directions=INTRODUCTIONS["account-lookup"], hints=hints, success=False)

    @app.route("/transfer", methods=("GET", "POST"))
    def transfer():
        if not unlocked("transfer"):
            return redirect(url_for("account_lookup"))
        if request.method == "GET":
            return render_template("level.html", level="transfer", title="Level 4: Transfer simulator", prompt="Prepare a simulated transfer", fields=["source_account", "destination_account", "amount"], directions=INTRODUCTIONS["transfer"])
        account_id = request.form.get("source_account", "")
        destination = request.form.get("destination_account", "")
        amount = request.form.get("amount", "")
        # Intentionally numeric and injectable, but never multi-statement.
        query = "SELECT id, account_number, owner, balance FROM accounts WHERE id = " + account_id
        try:
            rows = get_db().execute(query).fetchall()
        except sqlite3.Error:
            rows = []
        # No UPDATE/COMMIT occurs: this is a per-request simulation for a shared classroom.
        if rows and (" or " in account_id.lower() or "=" in account_id):
            complete("transfer")
            return render_template("result.html", title="Transfer simulation", message=f"A candidate source was selected for {destination or 'the destination'} ({amount or '0'} units), but no money moved. Level complete.", rows=rows, level="transfer", success=True)
        hints = fail("transfer")
        return render_template("result.html", title="Transfer simulation", message="No source selected. No money moved.", rows=rows, level="transfer", directions=INTRODUCTIONS["transfer"], hints=hints, success=False)

    @app.route("/secret-files/<path:filename>")
    def secret_file(filename):
        allowed = {"super_secret_employee_roster.txt", "super_secret_transaction_notes.txt", "super_secret_soc_report.txt"}
        if filename not in allowed or Path(filename).name != filename:
            abort(404)
        event = {"timestamp": datetime.now(timezone.utc).isoformat(), "filename": filename, "route": request.path, "method": request.method, "ip": request.remote_addr}
        app.logger.warning("SOC secret-file access %s", json.dumps(event, sort_keys=True))
        content = (SECRET_DIR / filename).read_text(encoding="utf-8")
        payload = {"event": event, "content": content, "warning": "Training secret only; server logs are authoritative."}
        if request.accept_mimetypes.best == "application/json":
            return jsonify(payload)
        return render_template("secret_file.html", filename=filename, content=content, event=event)

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
