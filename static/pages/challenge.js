/* Horizon Community Savings — GitHub Pages browser simulation.
 *
 * This is the static, browser-only version of the SQL injection lab. The
 * sql.js library provides a real SQLite engine compiled to WebAssembly that
 * runs an in-memory database inside this tab. After the engine loads from its
 * pinned CDN, nothing talks to a network: no server, no Python, no uploads.
 * The local Flask lab (app.py) is a separate program and is never contacted.
 *
 * The deliberately unsafe query construction below IS the lesson; it mirrors
 * the marked queries in app.py. All data is fictional. Level progress lives
 * only in this browser's localStorage, and the database rebuilds on reload.
 *
 * DOM rule: every value that can originate from the database or from form
 * input is rendered with createElement/textContent into safe text nodes.
 * Markup-assigning shortcuts (inner HTML properties, document writing) are
 * never used, so database values can never inject markup.
 */

"use strict";

/* Pinned engine sources. The .wasm file is resolved next to whichever script
 * loaded, via locateFile, so the JavaScript and wasm always come from the
 * same CDN version. */
const SQL_JS_SOURCES = [
  {
    script: "https://cdn.jsdelivr.net/npm/sql.js@1.13.0/dist/sql-wasm.js",
    base: "https://cdn.jsdelivr.net/npm/sql.js@1.13.0/dist/",
  },
  {
    script: "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.13.0/sql-wasm.js",
    base: "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.13.0/",
  },
];

const LEVELS = ["login", "search", "account-lookup", "transfer"];
const STORAGE_KEY = "hifob-browser-lab-v1";
/* TEST-NET-1 documentation range. GitHub Pages cannot know the real client
 * IP address; every SOC event here is fabricated and clearly labeled. */
const SIMULATED_IP = "192.0.2.42";

/* Fictional data, matching the Flask lab's schema.sql and seed_data.py. */
const SEED_USERS = [
  ["alex", "bluebird"],
  ["morgan", "sunrise"],
];
const SEED_PRODUCTS = [
  ["Horizon Checking", "checking", "Everyday local banking"],
  ["Community Saver", "savings", "A calm place for rainy days"],
  ["Student Starter", "checking", "Fictional practice account"],
];
const SEED_ACCOUNTS = [
  ["10001", "Alex Rivera", 1200],
  ["10002", "Morgan Lee", 875],
  ["10003", "Taylor Chen", 2400],
];
const SEED_SECRET_FILES = [
  {
    filename: "super_secret_employee_roster.txt",
    content: "FICTIONAL TRAINING DATA\nSimulated roster: Alex Rivera (teller), Morgan Lee (member services), Taylor Chen (night auditor). Any resemblance to real people is coincidental.",
  },
  {
    filename: "super_secret_transaction_notes.txt",
    content: "FICTIONAL TRAINING DATA\nSimulated note: on 2030-01-17 account 10003 moved 250 fictional units to account 10001. Balances in this simulation never change.",
  },
  {
    filename: "super_secret_soc_report.txt",
    content: "FICTIONAL TRAINING DATA\nSimulated SOC note: when a training secret is opened, check the simulated activity log. GitHub Pages cannot record real client IP addresses.",
  },
];

/* Three progressive hints per level, unlocked one at a time after failed
 * attempts. Payloads never appear here; hints stay conceptual, like app.py. */
const HINTS = {
  login: [
    "Read the code path: both fields are glued into one SQL string before the database sees it.",
    "Ask what an always-true condition would do to the WHERE clause that checks the password.",
    "Try changing the logic of the WHERE clause without knowing or guessing the password.",
  ],
  search: [
    "The catalog result displays three columns: name, category, and description.",
    "Appended UNION queries need the same number of columns with compatible shapes.",
    "Think about a second SELECT that reads a different fictional table using three suitable columns.",
  ],
  "account-lookup": [
    "Compare the response for the counter account 10001 with an unknown account number.",
    "A quoted account number can be closed early so extra boolean logic joins the condition.",
    "Use logic that is true for every account row, and keep everything a single SELECT.",
  ],
  transfer: [
    "The source account lands in the SQL as a numeric expression, not a quoted string.",
    "This level only ever runs a single SELECT; destination and amount are printed, never used in SQL.",
    "A numeric boolean condition can widen which account rows return as the candidate source.",
  ],
};

/* ------------------------------------------------------------------ state */

let SQLModule = null;
let db = null;
let productNames = new Set();
let engineReady = false;
let socLog = [];

function createFreshState() {
  const attempts = {};
  LEVELS.forEach((level) => { attempts[level] = 0; });
  return { completed: [], attempts: attempts };
}

const storage = {
  get() {
    try { return window.localStorage.getItem(STORAGE_KEY); } catch (_error) { return null; }
  },
  set(value) {
    try { window.localStorage.setItem(STORAGE_KEY, value); } catch (_error) { /* in-memory only */ }
  },
  remove() {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (_error) { /* in-memory only */ }
  },
};

function loadState() {
  const fresh = createFreshState();
  try {
    const raw = storage.get();
    if (!raw) return fresh;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.completed)) {
      fresh.completed = parsed.completed.filter((level) => LEVELS.includes(level));
    }
    if (parsed.attempts && typeof parsed.attempts === "object") {
      LEVELS.forEach((level) => {
        const count = Number(parsed.attempts[level]);
        if (Number.isFinite(count) && count > 0) fresh.attempts[level] = Math.floor(count);
      });
    }
  } catch (_error) {
    return createFreshState();
  }
  return fresh;
}

let state = loadState();

function persistState() {
  storage.set(JSON.stringify(state));
}

function isUnlocked(level) {
  const index = LEVELS.indexOf(level);
  return index === 0 || state.completed.includes(LEVELS[index - 1]);
}

/* ------------------------------------------------------------ DOM helpers */

function qs(selector, root) {
  return (root || document).querySelector(selector);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function levelSection(level) {
  return qs('[data-level="' + level + '"]');
}

function setControlsDisabled(section, disabled) {
  section.querySelectorAll("input, button, textarea, select").forEach((control) => {
    if (control.matches('[data-role="continue"]')) return; /* success buttons keep their own state */
    control.disabled = disabled;
  });
}

/* Every database or form value passes through textContent. */
function renderRowsTable(rows) {
  if (!rows || rows.length === 0) return null;
  const columns = Object.keys(rows[0]);
  const wrap = el("div", "table-wrap");
  const table = el("table");
  const head = el("thead");
  const headRow = el("tr");
  columns.forEach((name) => {
    const th = el("th", null, name);
    th.setAttribute("scope", "col");
    headRow.appendChild(th);
  });
  head.appendChild(headRow);
  table.appendChild(head);
  const body = el("tbody");
  rows.forEach((row) => {
    const tr = el("tr");
    columns.forEach((name) => {
      const value = row[name];
      tr.appendChild(el("td", null, value === null || value === undefined ? "" : String(value)));
    });
    body.appendChild(tr);
  });
  table.appendChild(body);
  wrap.appendChild(table);
  return wrap;
}

function showResult(level, options) {
  const section = levelSection(level);
  const result = qs('[data-role="result"]', section);
  clear(result);
  const tone = options.success ? "success" : "error";
  const message = el("p", tone, options.message);
  message.setAttribute("role", options.success ? "status" : "alert");
  result.appendChild(message);
  if (options.sql) {
    result.appendChild(el("p", "sql-echo-label", "Query sent to the in-memory database:"));
    result.appendChild(el("code", "sql-echo", options.sql));
  }
  const table = renderRowsTable(options.rows);
  if (table) result.appendChild(table);
  result.hidden = false;
  if (options.success) {
    const actions = qs('[data-role="success-actions"]', section);
    actions.hidden = false;
    qs('[data-role="continue"]', section).focus();
  } else {
    result.focus();
  }
}

function renderHints(level) {
  const section = levelSection(level);
  const count = Math.min(state.attempts[level], HINTS[level].length);
  qs('[data-role="hint-count"]', section).textContent = String(count);
  const list = qs('[data-role="hint-list"]', section);
  clear(list);
  for (let i = 0; i < count; i += 1) list.appendChild(el("li", null, HINTS[level][i]));
  qs('[data-role="hints"]', section).hidden = count === 0;
}

function renderLevelStates() {
  let completedCount = 0;
  LEVELS.forEach((level) => {
    const section = levelSection(level);
    const completed = state.completed.includes(level);
    const unlocked = isUnlocked(level);
    if (completed) completedCount += 1;
    section.classList.toggle("locked", !unlocked);
    section.classList.toggle("completed", completed);
    qs('[data-role="locked-note"]', section).hidden = unlocked;
    const status = qs('[data-role="status-line"]', section);
    if (completed) status.textContent = "Level complete. Reset the lab to try it again.";
    else if (unlocked && engineReady) status.textContent = "Ready for this level.";
    else if (unlocked) status.textContent = "Waiting for the browser SQLite engine to load.";
    else status.textContent = "Locked until the previous level is complete.";
    setControlsDisabled(section, !engineReady || !unlocked);
  });
  qs('[data-role="progress"]').textContent = completedCount + " of " + LEVELS.length + " levels complete";
}

/* ------------------------------------------------------------ database */

function buildDatabase(SQL) {
  const database = new SQL.Database();
  database.run(
    "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password TEXT);" +
    " CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, category TEXT, description TEXT);" +
    " CREATE TABLE accounts (id INTEGER PRIMARY KEY, account_number TEXT UNIQUE, owner TEXT, balance INTEGER);" +
    " CREATE TABLE secret_files (id INTEGER PRIMARY KEY, filename TEXT UNIQUE, content TEXT);"
  );
  SEED_USERS.forEach((row) => database.run("INSERT INTO users (username, password) VALUES (?, ?)", row));
  SEED_PRODUCTS.forEach((row) => database.run("INSERT INTO products (name, category, description) VALUES (?, ?, ?)", row));
  SEED_ACCOUNTS.forEach((row) => database.run("INSERT INTO accounts (account_number, owner, balance) VALUES (?, ?, ?)", row));
  SEED_SECRET_FILES.forEach((file) =>
    database.run("INSERT INTO secret_files (filename, content) VALUES (?, ?)", [file.filename, file.content])
  );
  return database;
}

function collectRows(results) {
  const rows = [];
  (results || []).forEach((result) => {
    const columns = result.columns;
    result.values.forEach((values) => {
      const row = {};
      columns.forEach((column, index) => { row[column] = values[index]; });
      rows.push(row);
    });
  });
  return rows;
}

/* Runs exactly one SELECT through sql.js. Multi-statement input is rejected
 * by the caller before reaching here, and only the four intentionally
 * vulnerable SELECT constructions ever call this. */
function execSingle(sql) {
  try {
    return { ok: true, rows: collectRows(db.exec(sql)) };
  } catch (_error) {
    return { ok: false, rows: [] };
  }
}

function containsStatementBreak(value) {
  return String(value).includes(";");
}

/* ------------------------------------------------- level query execution */

/* INTENTIONAL VULNERABILITY (classroom example): the username and password
 * are concatenated straight into the SQL text, mirroring app.py. */
function runLogin(fields) {
  const username = fields.username || "";
  const password = fields.password || "";
  if (containsStatementBreak(username) || containsStatementBreak(password)) {
    return { success: false, message: "Only a single SELECT statement runs in this simulation.", rows: [], sql: null };
  }
  const sql = "SELECT username FROM users WHERE username = '" + username + "' AND password = '" + password + "'";
  const outcome = execSingle(sql);
  if (outcome.ok && outcome.rows.length > 0) {
    return {
      success: true,
      message: "Login accepted — welcome, " + outcome.rows[0].username + ". Level complete.",
      rows: outcome.rows,
      sql: sql,
    };
  }
  return {
    success: false,
    message: "That sign-in did not work. Read the response and keep investigating.",
    rows: outcome.rows,
    sql: sql,
  };
}

/* INTENTIONAL VULNERABILITY: the search term is concatenated into a LIKE
 * clause, mirroring app.py. */
function runSearch(fields) {
  const term = fields.term || "";
  if (containsStatementBreak(term)) {
    return { success: false, message: "Only a single SELECT statement runs in this simulation.", rows: [], sql: null };
  }
  const sql = "SELECT name, category, description FROM products WHERE name LIKE '%" + term + "%'";
  const outcome = execSingle(sql);
  if (!outcome.ok) {
    return { success: false, message: "The database rejected the query (syntax error). Keep investigating.", rows: [], sql: sql };
  }
  /* Success is decided from actual returned rows, not from the input text:
   * a plain lookup can only return product rows, so any first-column value
   * that is not a real product name proves rows were pulled from another
   * table — the UNION-style lesson. */
  const foreignRows = outcome.rows.filter(
    (row) => !productNames.has(String(Object.values(row)[0]))
  );
  if (outcome.rows.length > 0 && foreignRows.length > 0) {
    return {
      success: true,
      message: "Extra rows appeared from outside the products table. The UNION lesson is complete. Notice the extra rows.",
      rows: outcome.rows,
      sql: sql,
    };
  }
  return {
    success: false,
    message: outcome.rows.length > 0
      ? "Only product rows came back. No training objective detected yet."
      : "No rows came back. No training objective detected yet.",
    rows: outcome.rows,
    sql: sql,
  };
}

/* INTENTIONAL VULNERABILITY: the account number is concatenated into the
 * quoted condition, mirroring app.py. */
function runAccountLookup(fields) {
  const value = fields.account_number || "";
  if (containsStatementBreak(value)) {
    return { success: false, message: "Only a single SELECT statement runs in this simulation.", rows: [], sql: null };
  }
  const sql = "SELECT account_number, owner, balance FROM accounts WHERE account_number = '" + value + "'";
  const outcome = execSingle(sql);
  const matched = outcome.ok && outcome.rows.length > 0;
  const conditionMessage = matched
    ? "Account match: the condition evaluated TRUE."
    : "No account match: the condition evaluated FALSE.";
  /* Detection uses returned-row behavior plus the typed query shape: a plain
   * lookup can match at most one row, so more than one returned row proves
   * the condition was broadened. A single-row match completes only when the
   * value demonstrably added boolean logic. A false condition returns no rows
   * and never completes. */
  const booleanized = /\b(or|and)\b/i.test(value);
  if (matched && (outcome.rows.length > 1 || booleanized)) {
    return { success: true, message: conditionMessage + " Level complete.", rows: outcome.rows, sql: sql };
  }
  return {
    success: false,
    message: matched
      ? conditionMessage + " That is the normal single-account lookup; keep investigating."
      : conditionMessage,
    rows: outcome.rows,
    sql: sql,
  };
}

/* INTENTIONAL VULNERABILITY: the source account is concatenated as a numeric
 * expression, mirroring app.py. The statement is always a single SELECT:
 * no UPDATE, DELETE, or multi-statement input ever runs, destination and
 * amount never enter SQL, and this in-memory database holds no real money
 * and is rebuilt on every page load. */
function runTransfer(fields) {
  const source = fields.source_account || "";
  const destination = fields.destination_account || "";
  const amount = fields.amount || "";
  if (containsStatementBreak(source) || containsStatementBreak(destination) || containsStatementBreak(amount)) {
    return { success: false, message: "Only a single SELECT statement runs in this simulation.", rows: [], sql: null };
  }
  const sql = "SELECT id, account_number, owner, balance FROM accounts WHERE id = " + source;
  const outcome = execSingle(sql);
  const matched = outcome.ok && outcome.rows.length > 0;
  /* Detection uses returned-row behavior plus the typed query shape: a plain
   * numeric source matches at most one row and does not complete; a widened
   * selection (several rows) or a numeric comparison with a match does. */
  const plainNumber = /^\d+$/.test(source);
  const booleanized = /[=<>]|\b(or|and)\b/i.test(source);
  if (matched && (outcome.rows.length > 1 || (booleanized && !plainNumber))) {
    return {
      success: true,
      message: "A candidate source was selected for " + (destination || "the destination") +
        " (" + (amount || "0") + " units), but no money moved. Level complete.",
      rows: outcome.rows,
      sql: sql,
    };
  }
  return {
    success: false,
    message: matched
      ? "One account matched a plain numeric lookup. The lesson needs a numeric boolean selection. No money moved."
      : "No source selected. No money moved.",
    rows: outcome.rows,
    sql: sql,
  };
}

const LEVEL_RUNNERS = {
  login: runLogin,
  search: runSearch,
  "account-lookup": runAccountLookup,
  transfer: runTransfer,
};

function handleSubmission(level, event) {
  event.preventDefault();
  if (!engineReady || !db) return;
  if (!isUnlocked(level)) return;
  const form = event.currentTarget;
  const fields = {};
  new FormData(form).forEach((value, key) => { fields[key] = String(value); });
  const outcome = LEVEL_RUNNERS[level](fields);
  if (outcome.success) {
    if (!state.completed.includes(level)) state.completed.push(level);
    persistState();
    renderLevelStates();
    showResult(level, outcome);
  } else {
    state.attempts[level] += 1;
    persistState();
    renderHints(level);
    showResult(level, outcome);
  }
}

/* ------------------------------------------------------------------- SOC */

function simulateSecretAccess(filename) {
  if (!engineReady || !db) return;
  const event = {
    timestamp: new Date().toISOString(),
    filename: filename,
    route: "/secret-files/" + filename,
    method: "GET",
    ip: SIMULATED_IP + " (simulated)",
  };
  /* Mirrors the Flask lab's server log, but this event is fabricated in the
   * browser: GitHub Pages cannot know the real client IP address. */
  console.warn(
    "SOC training alert (SIMULATED, browser-only — not a real server log). " +
    "GitHub Pages cannot know the real client IP address.",
    event
  );
  socLog.push(event);
  renderSocLog();
  showSecretContent(filename);
}

function showSecretContent(filename) {
  const view = qs('[data-role="secret-view"]');
  clear(view);
  /* Modeled-safe retrieval: a prepared statement with a bound parameter —
   * the defensive pattern the four challenge levels intentionally omit. */
  let content = "(The simulated file could not be read.)";
  try {
    const statement = db.prepare("SELECT content FROM secret_files WHERE filename = ?");
    statement.bind([filename]);
    if (statement.step()) content = String(statement.get()[0]);
    statement.free();
  } catch (_error) { /* keep fallback text */ }
  view.appendChild(el("p", "eyebrow", "FICTIONAL TRAINING FILE — SIMULATED ACCESS"));
  view.appendChild(el("h4", null, filename));
  view.appendChild(el("pre", "secret-content", content));
  view.appendChild(el("p", "soc-note", "Read with a parameterized query from the in-memory database. Nothing was sent anywhere."));
}

function renderSocLog() {
  const body = qs('[data-role="soc-log"]');
  clear(body);
  if (socLog.length === 0) {
    const tr = el("tr");
    const td = el("td", "empty-row", "No simulated secret-file access yet. Open a training file above to fabricate a clearly-labeled event.");
    td.colSpan = 5;
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }
  socLog.forEach((event) => {
    const tr = el("tr");
    [event.timestamp, event.filename, event.route, event.method, event.ip].forEach((value) => {
      tr.appendChild(el("td", null, String(value)));
    });
    body.appendChild(tr);
  });
}

/* ----------------------------------------------------------------- reset */

function resetLab() {
  const confirmed = window.confirm(
    "Reset the browser lab? This clears level progress, hint counters, and the simulated SOC log in this browser. The fictional in-memory database is rebuilt automatically."
  );
  if (!confirmed) return;
  state = createFreshState();
  storage.remove();
  socLog = [];
  if (db) {
    db.close();
    db = buildDatabase(SQLModule);
    cacheProductNames();
  }
  LEVELS.forEach((level) => {
    const section = levelSection(level);
    const result = qs('[data-role="result"]', section);
    clear(result);
    result.hidden = true;
    qs('[data-role="success-actions"]', section).hidden = true;
  });
  clear(qs('[data-role="secret-view"]'));
  renderLevelStates();
  LEVELS.forEach(renderHints);
  renderSocLog();
  const status = qs('[data-role="engine-status"]');
  status.textContent = "Lab reset. Level progress, hints, and the simulated SOC log were cleared in this browser.";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ------------------------------------------------------------ engine load */

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load " + src));
    document.head.appendChild(script);
  });
}

async function loadSqlJs() {
  let lastError = null;
  for (const source of SQL_JS_SOURCES) {
    try {
      await loadScript(source.script);
      if (typeof window.initSqlJs !== "function") {
        throw new Error("initSqlJs was not defined after loading " + source.script);
      }
      /* locateFile resolves sql-wasm.wasm next to the script that loaded, so
       * the engine and its wasm always come from the same pinned version. */
      return await window.initSqlJs({ locateFile: (file) => source.base + file });
    } catch (error) {
      lastError = error;
      console.warn("Trying the next pinned sql.js CDN source.", error);
    }
  }
  throw lastError || new Error("sql.js could not be loaded from any pinned CDN source.");
}

function cacheProductNames() {
  productNames = new Set();
  const result = db.exec("SELECT name FROM products");
  if (result.length > 0) {
    result[0].values.forEach((values) => productNames.add(String(values[0])));
  }
}

function setSocControlsDisabled(disabled) {
  document.querySelectorAll("[data-secret]").forEach((button) => { button.disabled = disabled; });
}

/* ------------------------------------------------------------------ init */

function wireEvents() {
  LEVELS.forEach((level) => {
    const section = levelSection(level);
    qs("form", section).addEventListener("submit", (event) => handleSubmission(level, event));
    qs('[data-role="continue"]', section).addEventListener("click", () => {
      const index = LEVELS.indexOf(level);
      const next = LEVELS[index + 1];
      if (next) {
        const target = levelSection(next);
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        const input = qs("input", target);
        if (input) input.focus({ preventScroll: true });
      } else {
        qs("#soc-activity").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
  document.querySelectorAll("[data-secret]").forEach((button) => {
    button.addEventListener("click", () => simulateSecretAccess(button.getAttribute("data-secret")));
  });
  qs('[data-role="reset-lab"]').addEventListener("click", resetLab);
}

async function init() {
  wireEvents();
  setSocControlsDisabled(true);
  renderLevelStates();
  LEVELS.forEach(renderHints);
  renderSocLog();
  try {
    SQLModule = await loadSqlJs();
    db = buildDatabase(SQLModule);
    cacheProductNames();
    engineReady = true;
    qs('[data-role="engine-status"]').textContent =
      "Browser SQLite engine ready. The database lives in this tab's memory only and resets when the page reloads.";
    setSocControlsDisabled(false);
    renderLevelStates();
  } catch (error) {
    console.error("The browser SQLite engine (sql.js) failed to load from every pinned CDN.", error);
    qs('[data-role="engine-error"]').hidden = false;
    qs('[data-role="engine-status"]').textContent = "The browser SQLite engine could not be loaded.";
    renderLevelStates();
  }
}

init();
