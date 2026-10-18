const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createAuditLogger,
  sanitizeMetadata,
  normalizeEvent,
} = require("../src/security/auditLogger");

test("audit logger writes only approved fields and safe metadata", async () => {
  const events = [];
  const logger = createAuditLogger({
    persistence: {
      async writeAuditEvent(event) {
        events.push(event);
      },
    },
    clock: () => new Date("2026-10-12T01:02:03.000Z"),
  });

  assert.equal(await logger.record({
    actorUserId: "11111111-1111-4111-8111-111111111111",
    connectionId: "22222222-2222-4222-8222-222222222222",
    provider: "xero",
    action: "oauth.completed",
    outcome: "success",
    requestId: "request-1",
    accessToken: "must-not-be-written",
    metadata: {
      connectionCount: 2,
      method: "POST",
      accessToken: "secret-token",
      authorizationCode: "secret-code",
      providerResponse: { secret: true },
    },
  }), true);

  assert.deepEqual(events, [{
    occurredAt: "2026-10-12T01:02:03.000Z",
    actorUserId: "11111111-1111-4111-8111-111111111111",
    connectionId: "22222222-2222-4222-8222-222222222222",
    provider: "xero",
    action: "oauth.completed",
    outcome: "success",
    errorCode: null,
    requestId: "request-1",
    metadata: { connectionCount: 2, method: "POST" },
  }]);
  assert.doesNotMatch(JSON.stringify(events), /secret|accessToken|authorizationCode/i);
});

test("audit logger does not break the business flow when persistence is unavailable", async () => {
  let writeFailureReported = false;
  const logger = createAuditLogger({
    persistence: {
      async writeAuditEvent() {
        throw new Error("database password rejected");
      },
    },
    onWriteFailure: () => {
      writeFailureReported = true;
    },
  });

  assert.equal(await logger.record({ action: "oauth.failed", outcome: "failure" }), false);
  assert.equal(writeFailureReported, true);
});

test("audit metadata rejects nested and unapproved values", () => {
  assert.deepEqual(sanitizeMetadata({
    connectionCount: 1,
    role: "admin",
    token: "secret",
    source: { nested: true },
  }), {
    connectionCount: 1,
    role: "admin",
  });
});

test("invalid UUIDs are omitted so denied requests remain auditable", () => {
  const event = normalizeEvent({
    action: "connection.access.denied",
    outcome: "denied",
    actorUserId: "not-a-uuid",
    connectionId: "not-a-uuid",
  }, "2026-10-15T00:00:00.000Z");
  assert.equal(event.actorUserId, null);
  assert.equal(event.connectionId, null);
  assert.equal(event.action, "connection.access.denied");
});

test("default audit failure warning contains no database details", async (t) => {
  const warning = t.mock.method(console, "warn", () => {});
  const logger = createAuditLogger({ persistence: {
    async writeAuditEvent() { throw new Error("password=secret"); },
  } });
  assert.equal(await logger.record({ action: "oauth.failed", outcome: "failure" }), false);
  assert.equal(warning.mock.callCount(), 1);
  assert.doesNotMatch(JSON.stringify(warning.mock.calls), /password|secret/);
});
