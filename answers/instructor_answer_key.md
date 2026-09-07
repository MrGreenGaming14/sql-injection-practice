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
