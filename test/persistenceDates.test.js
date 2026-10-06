const test = require("node:test");
const assert = require("node:assert/strict");

// Loading persistence only creates a lazy pool; it does not connect.
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://u:p@localhost:5432/none";
require("../src/persistence");
const { types } = require("pg");

test("Postgres DATE columns come back as plain YYYY-MM-DD strings", () => {
  // Without this parser pg builds a local-midnight Date, which becomes the
  // previous day once serialised to UTC (e.g. in Melbourne).
  assert.equal(types.getTypeParser(1082)("2026-08-31"), "2026-08-31");
});

test("persistence exports the account functions", () => {
  const p = require("../src/persistence");
  assert.equal(typeof p.getAccountsByConnection, "function");
  assert.equal(typeof p.saveAccounts, "function");
});
