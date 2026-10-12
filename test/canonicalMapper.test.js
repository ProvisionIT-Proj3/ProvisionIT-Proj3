const test = require("node:test");
const assert = require("node:assert/strict");

const { assertStorable } = require("../src/services/canonicalMapper");

const row = (overrides) => ({ id: "a", sourceSystem: "xero", name: "Sales", isHeader: false, level: 2, ...overrides });

test("assertStorable accepts valid, uniquely-identified rows", () => {
  assert.doesNotThrow(() => assertStorable("account", [row({ id: "a" }), row({ id: "b" })]));
});

test("assertStorable rejects a missing required field before the database does", () => {
  assert.throws(
    () => assertStorable("account", [row({ id: "a", name: undefined })]),
    (err) => err.code === "MAPPING_INVALID" && err.status === 502 && /row 1 \(a\).*'name'/.test(err.message)
  );
});

test("assertStorable rejects repeated ids", () => {
  assert.throws(
    () => assertStorable("account", [row({ id: "a" }), row({ id: "a" })]),
    (err) => err.code === "MAPPING_INVALID" && /row 2 \(a\): duplicate id/.test(err.message)
  );
});
