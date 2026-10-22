const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { inject } = require("./helpers/inject");

// a database url makes the route build its audit logger, the fake persistence below stops any real connection
process.env.DATABASE_URL = "postgres://fake";

const CONN = "5adce2dd-1331-4700-8600-c226221d89da";
const UNKNOWN = "00000000-0000-4000-8000-000000000000";

const listCalls = [];
const written = [];
inject("../src/persistence.js", {
  async getConnectionById(id) {
    return id === CONN ? { connection_id: CONN, platform: "xero", last_synced_at: null } : null;
  },
  async saveAccounts(connectionId, accounts) { return { saved: accounts.length }; },
  async listAuditEvents(options) {
    listCalls.push(options);
    return {
      total: 41,
      rows: [{
        audit_id: "11111111-1111-4111-8111-111111111111",
        occurred_at: new Date("2026-10-22T09:30:00Z"),
        actor_user_id: "22222222-2222-4222-8222-222222222222",
        connection_id: CONN,
        provider: "xero",
        action: "sync.completed",
        outcome: "success",
        error_code: null,
        company_name: "Riverbend Cafe",
      }],
    };
  },
  async writeAuditEvent(event) { written.push(event); },
});
inject("../src/auth/index.js", {
  registry: { resolveProvider: async (id) => (id === CONN ? "xero" : null) },
  router: express.Router(),
});
inject("../src/connector/connectorFactory.js", {
  createConnector: () => ({ getAccounts: async () => [{ id: "acc_1", sourceSystem: "xero", name: "Cash", isHeader: false, level: 2 }] }),
});

const app = require("../src/app");
const { createAccessControl, rolePermissions } = require("../src/middleware/auth");
const { waitForAuditWrites } = require("../src/security/auditLogger");

test.beforeEach(() => {
  listCalls.length = 0;
  written.length = 0;
  test.mock.method(console, "warn", () => {});
});

async function call(path, method = "GET") {
  const server = http.createServer(app).listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

test("GET /activity returns the newest events with company names and paging", async () => {
  const { status, body } = await call("/api/v1/activity?page=3&pageSize=20");
  assert.equal(status, 200);
  assert.deepEqual(listCalls, [{ limit: 20, offset: 40, includeRoutine: false }]);
  assert.deepEqual(body.pagination, { page: 3, pageSize: 20, totalItems: 41, totalPages: 3 });
  assert.deepEqual(body.data[0], {
    id: "11111111-1111-4111-8111-111111111111",
    occurredAt: "2026-10-22T09:30:00.000Z",
    action: "sync.completed",
    outcome: "success",
    errorCode: null,
    provider: "xero",
    connectionId: CONN,
    companyName: "Riverbend Cafe",
    actorUserId: "22222222-2222-4222-8222-222222222222",
  });
});

test("GET /activity hides routine events unless ?all=true", async () => {
  await call("/api/v1/activity");
  await call("/api/v1/activity?all=true");
  assert.deepEqual(listCalls.map((c) => c.includeRoutine), [false, true]);
});

test("GET /activity rejects a bad page with a 400", async () => {
  const { status, body } = await call("/api/v1/activity?page=abc");
  assert.equal(status, 400);
  assert.equal(body.error.code, "INVALID_PARAMETER");
  assert.equal(listCalls.length, 0);
});

test("only admins hold the audit:read permission", async () => {
  assert.ok(rolePermissions.admin.includes("audit:read"));
  assert.ok(!rolePermissions.user.includes("audit:read"));

  const access = createAccessControl({
    env: { AUTH_REQUIRED: "true" },
    getRole: async () => null,
    hasConnectionAccess: async () => false,
    listUserConnections: async () => [],
    auditLogger: null,
  });
  const run = (req) => new Promise((resolve) => access.requirePermission("audit:read")(req, {}, resolve));
  const denied = await run({ user: { id: "u1", role: "user" } });
  assert.equal(denied.status, 403);
  assert.equal(denied.code, "INSUFFICIENT_PERMISSION");
  assert.equal(await run({ user: { id: "a1", role: "admin" } }), undefined);
});

test("a finished sync is written to the audit log", async () => {
  const { status } = await call(`/api/v1/sync?connectionId=${CONN}`, "POST");
  assert.equal(status, 200);
  await waitForAuditWrites();
  const event = written.find((e) => e.action === "sync.completed");
  assert.ok(event, "expected a sync.completed event");
  assert.equal(event.outcome, "success");
  assert.equal(event.connectionId, CONN);
  assert.deepEqual(event.metadata, { method: "POST", path: "/sync" });
});

test("a failed sync is written to the audit log with its error code", async () => {
  const { status } = await call(`/api/v1/sync?connectionId=${UNKNOWN}`, "POST");
  assert.equal(status, 404);
  await waitForAuditWrites();
  const event = written.find((e) => e.action === "sync.failed");
  assert.ok(event, "expected a sync.failed event");
  assert.equal(event.outcome, "failure");
  assert.equal(event.errorCode, "CONNECTION_NOT_FOUND");
});
