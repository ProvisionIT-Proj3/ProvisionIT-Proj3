const test = require("node:test");
const assert = require("node:assert/strict");
const { createAccessControl } = require("../src/middleware/auth");

const AUTH_ON = { AUTH_REQUIRED: "true" };

function createRequest({
  authorization = "Bearer secret-token",
  connectionId = null,
  method = "GET",
  path = "/api/v1/accounts",
  role = null,
  userId = null,
} = {}) {
  return {
    connectionId,
    method,
    path,
    user: userId ? { id: userId, role } : undefined,
    get(name) {
      if (name.toLowerCase() === "authorization") return authorization;
      if (name.toLowerCase() === "x-request-id") return "request-1";
      return undefined;
    },
  };
}

function runMiddleware(middleware, req) {
  return new Promise((resolve) => middleware(req, {}, resolve));
}

function createAuditLogger(events) {
  return {
    async record(event) {
      events.push(event);
    },
  };
}

test("authentication audit uses the trusted identity without recording the bearer token", async () => {
  const events = [];
  const access = createAccessControl({
    env: AUTH_ON,
    getRole: async () => "admin",
    supabaseClient: {
      auth: {
        getUser: async () => ({
          data: { user: { id: "admin-1", email: "admin@example.com" } },
          error: null,
        }),
      },
    },
    auditLogger: createAuditLogger(events),
  });
  const req = createRequest();

  assert.equal(await runMiddleware(access.authenticate, req), undefined);
  assert.deepEqual(events, [{
    requestId: "request-1",
    connectionId: null,
    actorUserId: "admin-1",
    action: "authentication.succeeded",
    outcome: "success",
    metadata: { method: "GET", path: "/api/v1/accounts", role: "admin" },
  }]);
  assert.doesNotMatch(JSON.stringify(events), /secret-token|authorization/i);
});

test("permission denials record the trusted actor, permission, and safe error code", async () => {
  const events = [];
  const access = createAccessControl({
    env: AUTH_ON,
    auditLogger: createAuditLogger(events),
  });
  const req = createRequest({ role: "user", userId: "user-1" });
  req.params = { connectionId: "connection-1" };

  const error = await runMiddleware(access.requirePermission("connections:manage"), req);

  assert.equal(error.code, "INSUFFICIENT_PERMISSION");
  assert.deepEqual(events, [{
    requestId: "request-1",
    connectionId: "connection-1",
    actorUserId: "user-1",
    action: "authorization.denied",
    outcome: "denied",
    errorCode: "INSUFFICIENT_PERMISSION",
    metadata: {
      method: "GET",
      path: "/api/v1/accounts",
      permission: "connections:manage",
      role: "user",
    },
  }]);
});

test("role lookup failures retain the identity already verified by Supabase", async () => {
  const events = [];
  const access = createAccessControl({
    env: AUTH_ON,
    getRole: async () => {
      throw new Error("database details");
    },
    supabaseClient: {
      auth: {
        getUser: async () => ({
          data: { user: { id: "user-1", email: "user@example.com" } },
          error: null,
        }),
      },
    },
    auditLogger: createAuditLogger(events),
  });

  const error = await runMiddleware(access.authenticate, createRequest());

  assert.equal(error.code, "AUTHORIZATION_SERVICE_UNAVAILABLE");
  assert.equal(events[0].actorUserId, "user-1");
  assert.equal(events[0].errorCode, "AUTHORIZATION_SERVICE_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(events), /database details|secret-token/);
});

test("connection-level access decisions are auditable without revealing another tenant", async () => {
  const events = [];
  const access = createAccessControl({
    env: AUTH_ON,
    hasConnectionAccess: async () => false,
    auditLogger: createAuditLogger(events),
  });
  const req = createRequest({
    connectionId: "connection-2",
    role: "user",
    userId: "user-1",
  });

  const error = await runMiddleware(access.requireConnectionAccess, req);

  assert.equal(error.status, 404);
  assert.equal(error.code, "CONNECTION_NOT_FOUND");
  assert.deepEqual(events, [{
    requestId: "request-1",
    connectionId: "connection-2",
    actorUserId: "user-1",
    action: "connection.access.denied",
    outcome: "denied",
    errorCode: "CONNECTION_NOT_FOUND",
    metadata: { method: "GET", path: "/api/v1/accounts", role: "user" },
  }]);
});

test("accessible connection lists record only the count, not connection contents", async () => {
  const events = [];
  const access = createAccessControl({
    env: AUTH_ON,
    listUserConnections: async () => [
      { connection_id: "connection-1", company_name: "Sensitive Company" },
    ],
    auditLogger: createAuditLogger(events),
  });
  const req = createRequest({ role: "user", userId: "user-1" });

  assert.equal(await runMiddleware(access.loadAccessibleConnections, req), undefined);
  assert.equal(events[0].metadata.tenantCount, 1);
  assert.doesNotMatch(JSON.stringify(events), /Sensitive Company/);
});

test("audit storage failures do not change an allowed access-control decision", async () => {
  const access = createAccessControl({
    env: AUTH_ON,
    auditLogger: {
      async record() {
        throw new Error("audit database unavailable");
      },
    },
  });
  const req = createRequest({ role: "admin", userId: "admin-1" });

  assert.equal(
    await runMiddleware(access.requirePermission("connections:manage"), req),
    undefined,
  );
});
