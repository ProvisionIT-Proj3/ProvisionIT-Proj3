const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const {
  createAccessControl,
  readBearerToken,
} = require("../src/middleware/auth");
const createXeroRouter = require("../src/auth/providers/xero/router");
const createQuickBooksRouter = require("../src/auth/providers/quickbooks/router");

const AUTH_ON = { AUTH_REQUIRED: "true" };

function createDependencies({ role = "user", user = { id: "user-1", email: "user@example.com" } } = {}) {
  return {
    env: AUTH_ON,
    getRole: async () => role,
    supabaseClient: {
      auth: {
        getUser: async () => ({ data: { user }, error: null }),
      },
    },
  };
}

function requestWithAuthorization(authorization) {
  return {
    get(name) {
      return name.toLowerCase() === "authorization" ? authorization : undefined;
    },
  };
}

function runMiddleware(middleware, req) {
  return new Promise((resolve) => middleware(req, {}, resolve));
}

async function call(app, method, path, token, headers = {}) {
  const server = http.createServer(app).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      redirect: "manual",
      headers: {
        ...headers,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    const body = response.status === 204 ? null : await response.json();
    return { body, headers: response.headers, status: response.status };
  } finally {
    server.close();
  }
}

test("accepts only a single Bearer token", () => {
  assert.equal(readBearerToken("Bearer abc.def"), "abc.def");
  assert.equal(readBearerToken("bearer token"), "token");
  assert.equal(readBearerToken("Basic token"), null);
  assert.equal(readBearerToken("Bearer"), null);
  assert.equal(readBearerToken("Bearer one two"), null);
  assert.equal(readBearerToken(undefined), null);
});

test("access control remains disabled until AUTH_REQUIRED is enabled", async () => {
  const access = createAccessControl({ env: {}, getRole: async () => null });
  const req = requestWithAuthorization();

  assert.equal(await runMiddleware(access.authenticate, req), undefined);
  assert.equal(await runMiddleware(access.requirePermission("connections:manage"), req), undefined);
});

test("authentication sets only the trusted user identity and database role", async () => {
  const access = createAccessControl(createDependencies({ role: "admin" }));
  const req = requestWithAuthorization("Bearer valid-token");

  assert.equal(await runMiddleware(access.authenticate, req), undefined);
  assert.deepEqual(req.user, {
    id: "user-1",
    email: "user@example.com",
    role: "admin",
  });
});

test("missing and invalid access tokens return distinct 401 errors", async () => {
  const missingAccess = createAccessControl(createDependencies());
  const missing = await runMiddleware(
    missingAccess.authenticate,
    requestWithAuthorization(),
  );
  assert.equal(missing.status, 401);
  assert.equal(missing.code, "AUTHENTICATION_REQUIRED");

  const dependencies = createDependencies();
  dependencies.supabaseClient.auth.getUser = async () => ({
    data: { user: null },
    error: new Error("invalid JWT details"),
  });
  const invalidAccess = createAccessControl(dependencies);
  const invalid = await runMiddleware(
    invalidAccess.authenticate,
    requestWithAuthorization("Bearer invalid-token"),
  );
  assert.equal(invalid.status, 401);
  assert.equal(invalid.code, "INVALID_ACCESS_TOKEN");
  assert.doesNotMatch(invalid.message, /JWT/i);
});

test("authentication and role service failures return safe 503 errors", async () => {
  const authDependencies = createDependencies();
  authDependencies.supabaseClient.auth.getUser = async () => {
    throw new Error("network details");
  };
  const authFailure = await runMiddleware(
    createAccessControl(authDependencies).authenticate,
    requestWithAuthorization("Bearer valid-token"),
  );
  assert.equal(authFailure.status, 503);
  assert.equal(authFailure.code, "AUTHENTICATION_SERVICE_UNAVAILABLE");
  assert.doesNotMatch(authFailure.message, /network/i);

  const roleDependencies = createDependencies();
  roleDependencies.getRole = async () => {
    throw new Error("database password details");
  };
  const roleFailure = await runMiddleware(
    createAccessControl(roleDependencies).authenticate,
    requestWithAuthorization("Bearer valid-token"),
  );
  assert.equal(roleFailure.status, 503);
  assert.equal(roleFailure.code, "AUTHORIZATION_SERVICE_UNAVAILABLE");
  assert.doesNotMatch(roleFailure.message, /password/i);
});

test("roles enforce the agreed permission matrix and unknown roles fail closed", async () => {
  const access = createAccessControl(createDependencies());
  const user = { user: { id: "user-1", role: "user" } };
  const admin = { user: { id: "admin-1", role: "admin" } };

  assert.equal(await runMiddleware(access.requirePermission("accounting:read"), user), undefined);
  for (const permission of ["accounting:sync", "connections:read", "connections:manage"]) {
    const denied = await runMiddleware(access.requirePermission(permission), user);
    assert.equal(denied.status, 403);
    assert.equal(denied.code, "INSUFFICIENT_PERMISSION");
    assert.equal(await runMiddleware(access.requirePermission(permission), admin), undefined);
  }

  const unknownRole = await runMiddleware(
    access.requirePermission("accounting:read"),
    { user: { id: "unknown-1", role: "staff" } },
  );
  assert.equal(unknownRole.status, 403);
  assert.equal(unknownRole.code, "INSUFFICIENT_PERMISSION");
});

test("an authenticated user without a profile receives USER_PROFILE_REQUIRED", async () => {
  const access = createAccessControl(createDependencies({ role: null }));
  const req = requestWithAuthorization("Bearer valid-token");

  assert.equal(await runMiddleware(access.authenticate, req), undefined);
  const error = await runMiddleware(access.requirePermission("accounting:read"), req);
  assert.equal(error.status, 403);
  assert.equal(error.code, "USER_PROFILE_REQUIRED");
});

test("users can access only assigned connections while admins bypass tenant checks", async () => {
  const checkedConnections = [];
  const ownConnections = [{ connection_id: "connection-1", company_name: "Own Company" }];
  const access = createAccessControl({
    ...createDependencies(),
    hasConnectionAccess: async (userId, connectionId) => {
      checkedConnections.push({ userId, connectionId });
      return connectionId === "connection-1";
    },
    listUserConnections: async (userId) => {
      assert.equal(userId, "user-1");
      return ownConnections;
    },
  });

  const assigned = { connectionId: "connection-1", user: { id: "user-1", role: "user" } };
  assert.equal(await runMiddleware(access.requireConnectionAccess, assigned), undefined);

  const otherTenant = { connectionId: "connection-2", user: { id: "user-1", role: "user" } };
  const denied = await runMiddleware(access.requireConnectionAccess, otherTenant);
  assert.equal(denied.status, 404);
  assert.equal(denied.code, "CONNECTION_NOT_FOUND");

  const admin = { connectionId: "connection-2", user: { id: "admin-1", role: "admin" } };
  assert.equal(await runMiddleware(access.requireConnectionAccess, admin), undefined);
  assert.deepEqual(checkedConnections, [
    { userId: "user-1", connectionId: "connection-1" },
    { userId: "user-1", connectionId: "connection-2" },
  ]);

  const listRequest = { user: { id: "user-1", role: "user" } };
  assert.equal(await runMiddleware(access.loadAccessibleConnections, listRequest), undefined);
  assert.equal(listRequest.accessibleConnections, ownConnections);
});

test("connection access persistence failures return a safe 503", async () => {
  const access = createAccessControl({
    ...createDependencies(),
    hasConnectionAccess: async () => {
      throw new Error("database details");
    },
    listUserConnections: async () => {
      throw new Error("database details");
    },
  });
  const req = { connectionId: "connection-1", user: { id: "user-1", role: "user" } };

  const checkError = await runMiddleware(access.requireConnectionAccess, req);
  assert.equal(checkError.status, 503);
  assert.equal(checkError.code, "CONNECTION_ACCESS_SERVICE_UNAVAILABLE");
  assert.doesNotMatch(checkError.message, /database/i);

  const listError = await runMiddleware(access.loadAccessibleConnections, req);
  assert.equal(listError.status, 503);
  assert.equal(listError.code, "CONNECTION_ACCESS_SERVICE_UNAVAILABLE");
  assert.doesNotMatch(listError.message, /database/i);
});

test("OAuth management requires admin access while callbacks remain available", async () => {
  const users = {
    "admin-token": { id: "admin-1", email: "admin@example.com" },
    "user-token": { id: "user-1", email: "user@example.com" },
  };
  const access = createAccessControl({
    env: AUTH_ON,
    getRole: async (userId) => (userId === "admin-1" ? "admin" : "user"),
    supabaseClient: {
      auth: {
        getUser: async (token) => ({
          data: { user: users[token] || null },
          error: users[token] ? null : new Error("invalid"),
        }),
      },
    },
  });
  const authorizationMetadata = [];
  const service = {
    getAuthorizationUrl(metadata) {
      authorizationMetadata.push(metadata);
      return "https://login.example/authorize";
    },
    async completeAuthorization() {
      return [];
    },
    async listConnections() {
      return [];
    },
    async disconnect() {},
  };
  const dependencies = {
    service,
    assertConfigured() {},
    authenticate: access.authenticate,
    requirePermission: access.requirePermission,
  };
  const app = express();
  app.use(createXeroRouter(dependencies));
  app.use(createQuickBooksRouter(dependencies));
  app.use((error, req, res, next) => res.status(error.status || 500).json({
    error: { code: error.code, message: error.message },
  }));

  for (const provider of ["xero", "quickbooks"]) {
    assert.equal((await call(app, "GET", `/${provider}/connect`)).status, 401);
    assert.equal((await call(app, "GET", `/${provider}/connect`, "user-token")).status, 403);

    const start = await call(
      app,
      "GET",
      `/${provider}/connect`,
      "admin-token",
      { accept: "application/json" },
    );
    assert.equal(start.status, 200);
    assert.equal(start.body.data.authorizationUrl, "https://login.example/authorize");

    assert.equal((await call(app, "GET", `/${provider}/callback`)).status, 201);
    assert.equal((await call(app, "GET", `/${provider}/connections`, "user-token")).status, 403);
    assert.equal((await call(app, "GET", `/${provider}/connections`, "admin-token")).status, 200);
    assert.equal((await call(app, "DELETE", `/${provider}/connections/id`, "user-token")).status, 403);
    assert.equal((await call(app, "DELETE", `/${provider}/connections/id`, "admin-token")).status, 204);
  }

  assert.deepEqual(authorizationMetadata, [
    { actorUserId: "admin-1" },
    { actorUserId: "admin-1" },
  ]);
});

test("missing Supabase configuration fails closed when access control is enabled", async () => {
  const access = createAccessControl({ env: AUTH_ON, getRole: async () => "admin" });
  const error = await runMiddleware(
    access.authenticate,
    requestWithAuthorization("Bearer any-token"),
  );

  assert.equal(error.status, 500);
  assert.equal(error.code, "AUTH_CONFIGURATION_ERROR");
});
