const test = require("node:test");
const assert = require("node:assert/strict");
const errorHandler = require("../src/middleware/errorHandler");

function response() {
  return {
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

test("internal errors expose neither database messages nor codes", (t) => {
  const log = t.mock.method(console, "error", () => {});
  const res = response();
  errorHandler(Object.assign(new Error("password=secret SELECT credentials"), { code: "28P01" }), {}, res, () => {});
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body.error, { code: "SERVER_ERROR", message: "Something went wrong." });
  assert.doesNotMatch(JSON.stringify(log.mock.calls), /password|secret|SELECT|28P01/);
});

test("safe service error codes are preserved with a fixed public message", (t) => {
  t.mock.method(console, "error", () => {});
  const res = response();
  errorHandler(Object.assign(new Error("password=secret"), {
    status: 503, code: "AUTHENTICATION_SERVICE_UNAVAILABLE",
  }), {}, res, () => {});
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, "AUTHENTICATION_SERVICE_UNAVAILABLE");
  assert.equal(res.body.error.message, "The authentication service is unavailable.");
});

test("validation errors preserve the existing API response", () => {
  const res = response();
  errorHandler(Object.assign(new Error("connectionId is required."), {
    status: 400, code: "MISSING_CONNECTION_ID",
  }), {}, res, () => {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, "MISSING_CONNECTION_ID");
  assert.equal(res.body.error.message, "connectionId is required.");
});
