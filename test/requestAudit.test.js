const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createRequestAuditRecorder } = require("../src/security/requestAudit");
const { createAuditLogger, waitForAuditWrites } = require("../src/security/auditLogger");
const { createAccessControl } = require("../src/middleware/auth");

test("one request batches all access decisions without waiting for storage", async () => {
  const batches = [];
  let finishWrite;
  const auditLogger = createAuditLogger({ persistence: {
    async writeAuditEvent() { assert.fail("expected one batch INSERT"); },
    writeAuditEvents(events) {
      batches.push(events);
      return new Promise((resolve) => { finishWrite = resolve; });
    },
  } });
  const access = createAccessControl({
    env: { AUTH_REQUIRED: "true" }, auditLogger,
    getRole: async () => "user", hasConnectionAccess: async () => true,
    supabaseClient: { auth: { getUser: async () => ({
      data: { user: { id: "11111111-1111-4111-8111-111111111111" } }, error: null,
    }) } },
  });
  const res = new EventEmitter();
  const req = { res, method: "GET", path: "/accounts",
    get: (name) => name === "authorization" ? "Bearer secret-token" : "request-1",
    connectionId: "22222222-2222-4222-8222-222222222222" };
  const run = (middleware) => new Promise((resolve) => middleware(req, res, resolve));
  assert.equal(await run(access.authenticate), undefined);
  assert.equal(await run(access.requirePermission("accounting:read")), undefined);
  assert.equal(await run(access.requireConnectionAccess), undefined);
  assert.equal(batches.length, 0);

  res.emit("finish");
  res.emit("close");
  await Promise.resolve();
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].map((event) => event.action), [
    "authentication.succeeded", "authorization.granted", "connection.access.granted",
  ]);
  assert.doesNotMatch(JSON.stringify(batches), /secret-token/);
  finishWrite();
  await waitForAuditWrites();
});

test("closed connections flush once and concurrent requests stay separate", async () => {
  const batches = [];
  const record = createRequestAuditRecorder({ recordMany: async (events) => batches.push(events) });
  const first = {}, second = {};
  const firstRes = new EventEmitter(), secondRes = new EventEmitter();
  await record(first, firstRes, { action: "first" });
  await record(second, secondRes, { action: "second" });
  firstRes.emit("close");
  firstRes.emit("finish");
  secondRes.emit("finish");
  await Promise.resolve();
  assert.deepEqual(batches, [[{ action: "first" }], [{ action: "second" }]]);
});

test("batch errors are reported without unhandled rejection or private details", async (t) => {
  const warning = t.mock.method(console, "warn", () => {});
  const record = createRequestAuditRecorder({ recordMany: async () => { throw new Error("password=secret"); } });
  const res = new EventEmitter();
  await record({}, res, { action: "test" });
  res.emit("finish");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(warning.mock.callCount(), 1);
  assert.doesNotMatch(JSON.stringify(warning.mock.calls), /password|secret/);
});
