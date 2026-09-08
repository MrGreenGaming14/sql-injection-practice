# Instructor Answer Key

This file is intentionally outside the published Pages directory. The following are **authorized classroom examples for this fictional local lab only**. Never use them against systems without explicit permission.

## Required Order

Complete the levels sequentially in one browser session. A successful submission at one level unlocks the next: Login -> Search -> Account lookup -> Transfer. The normal Level 1 credentials are `alex` / `bluebird`; the injection path below is an alternative demonstration, not a real credential.

## Level 1: Sign-in

URL: `POST /login` (the form at `/login`)

Normal path, exact fields:

- Username: `alex`
- Password: `bluebird`

Authorized classroom injection path, exact fields:

- Username: `' OR '1'='1' -- ` (including the space after the two hyphens)
- Password: `anything`

Expected visible result: `Login accepted`, `Welcome, alex. Level complete.` Level 2 becomes available. The normal path also produces the same success result.

How it changes the SQL: the vulnerable code constructs `SELECT username FROM users WHERE username = '' OR '1'='1' -- ' AND password = 'anything'`. The true condition matches a user and `-- ` comments out the password check.

Secure remediation: use a parameterized query such as `SELECT username FROM users WHERE username = ? AND password = ?`, store password hashes, and return a generic failure message.

## Level 2: Catalog search

URL: `POST /search` (the `term` field at `/search`), after Level 1 succeeds.

Exact field:

- Term: `' UNION SELECT username,password,'x' FROM users -- ` (including the space after the two hyphens)

Expected visible result: `Search results`, `The UNION lesson is complete. Notice the extra rows.` The result table includes user-shaped rows such as `alex`, `bluebird`, and `x`; Level 3 becomes available.

How it changes the SQL: the input closes the `LIKE` string, adds `UNION SELECT username,password,'x' FROM users`, and comments out the trailing `%` and quote. The three selected columns match the three displayed product columns.

Secure remediation: bind the search term (`WHERE name LIKE ?`) and allow-list any selectable sort or field names rather than concatenating input.

## Level 3: Account lookup

URL: `POST /account-lookup` (the `account_number` field at `/account-lookup`), after Level 2 succeeds.

Exact field:

- Account number: `10001' OR '1'='1`

Expected visible result: `Account match: the condition evaluated TRUE. Level complete.` Rows for all three fictional accounts are shown and Level 4 becomes available. For the comparison, `10001' AND '1'='2` shows `No account match: the condition evaluated FALSE.` but does not complete the level.

How it changes the SQL: the true example becomes `... WHERE account_number = '10001' OR '1'='1'`, so every account row matches. The comparison changes the appended condition to false.

Secure remediation: use `WHERE account_number = ?`, validate the expected account-number format, and do not disclose database-condition results in user-facing messages.

## Level 4: Transfer simulator

URL: `POST /transfer` (the form at `/transfer`), after Level 3 succeeds.

Exact fields:

- Source account: `1 OR 1=1`
- Destination account: `10002`
- Amount: `25`

Expected visible result: `Transfer simulation` and `A candidate source was selected for 10002 (25 units), but no money moved. Level complete.` The source row is displayed and the database balance remains unchanged.

How it changes the SQL: the source value creates `SELECT ... FROM accounts WHERE id = 1 OR 1=1`, selecting account rows instead of one numeric ID. Destination and amount are displayed by the simulator and are not used in SQL.

Secure remediation: parse the source and destination as integers, bind them as parameters, authorize the source-to-destination operation, validate the amount as a bounded decimal, and use an explicit transaction policy. Keep the simulation separate from any real transfer.

## Browser sql.js simulation (GitHub Pages)

These classroom examples run in the static browser lab at `static/pages/challenge.html`, published by the Pages workflow. Everything executes in the browser: sql.js (pinned CDN) drives an in-memory SQLite database seeded with the same fictional data, so there is no server, no URL, and no server log. Open `challenge.html` from the Pages deployment, type the values below into the labeled form fields, and press `Run query`. The same values work in both modes; the differences are only where they run and what is logged.

Required order and locking are identical: Level 1 -> 2 -> 3 -> 4, and later levels stay disabled until the previous one succeeds. Reset lab clears progress, hint counters, and the simulated SOC log in that browser. All fields below are the exact HTML input names on the page.

### Level 1: Sign-in (browser)

Fields:

- Username: `alex`
- Password: `bluebird`

That normal sticky-note sign-in is the expected classroom path. Authorized injection alternative:

- Username: `' OR '1'='1' -- ` (including the space after the two hyphens)
- Password: `anything`

Expected visible result: a green `Login accepted — welcome, alex. Level complete.` message, the constructed query echoed under `Query sent to the in-memory database`, a table of matched usernames, and the `Continue to level 2` button. Progress reads `1 of 4 levels complete`.

### Level 2: Catalog search (browser)

Field:

- Search term: `' UNION SELECT username,password,'x' FROM users -- ` (including the space after the two hyphens)

Expected visible result: a green success message (`Extra rows appeared from outside the products table. The UNION lesson is complete. Notice the extra rows.`), one table showing the three product rows plus user-shaped rows (`alex`, `bluebird`, `x` and `morgan`, `sunrise`, `x`), and Level 3 unlocking. Detection is row-based: the browser flags success only when returned rows contain first-column values that are not product names.

### Level 3: Account lookup (browser)

Field:

- Account number: `10001' OR '1'='1`

Expected visible result: `Account match: the condition evaluated TRUE. Level complete.`, a table listing all three fictional accounts (10001 Alex Rivera 1200, 10002 Morgan Lee 875, 10003 Taylor Chen 2400), and Level 4 unlocking. For the comparison, `10001` alone shows the normal TRUE single-row match but does not complete, and `10001' AND '1'='2` shows `No account match: the condition evaluated FALSE.` without completing.

### Level 4: Transfer simulator (browser)

Fields:

- Source account: `1 OR 1=1`
- Destination account: `10002`
- Amount: `25`

Expected visible result: `A candidate source was selected for 10002 (25 units), but no money moved. Level complete.`, a table of the three account rows as the candidate source, and the `Finish: review the SOC activity` button. Destination and amount appear in the receipt only; they never enter SQL. Only a single SELECT ever runs, and the in-memory database is rebuilt on reload, so there is nothing to roll back.

### Browser SOC activity (fictional, not a server log)

Clicking any `Simulate access` button (employee roster, transaction notes, or SOC report) fabricates a labeled event: a timestamp, the fictional filename, a simulated route, method GET, and source IP `192.0.2.42` (TEST-NET-1). The event is appended to the visible simulated activity log and a console warning is printed. GitHub Pages serves static files only, so this log is explicitly not a real server-side IP log; only the local Flask lab produces real server logs.
