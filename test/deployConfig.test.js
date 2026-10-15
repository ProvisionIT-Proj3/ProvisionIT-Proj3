const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { inject } = require("./helpers/inject");

// Fakes: no database, no OAuth config, no Supabase (same approach as auth.test.js).
inject("../src/persistence.js", {
  getUserRole: async () => null,
  getConnectionById: async () => null,
  getAccountsByConnection: async () => [],
  saveAccounts: async (c, a) => ({ saved: a.length }),
});
const oauth = express.Router();
inject("../src/auth/index.js", { registry: { resolveProvider: async () => "xero" }, router: oauth });
inject("../src/connector/connectorFactory.js", {
  createConnector: () => ({ getAccounts: async () => [], getTrialBalance: async () => ({}) }),
});

const { createCors, parseOrigins } = require("../src/middleware/cors");
const { checkEnv } = require("../src/config/checkEnv");

async function call(app, method, path, headers = {}) {
  const server = http.createServer(app).listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers });
    return { status: res.status, headers: res.headers, text: await res.text() };
  } finally {
    server.close();
  }
}

function corsApp(env) {
  const app = express();
  app.use(createCors({ env }));
  app.get("/thing", (req, res) => res.json({ ok: true }));
  return app;
}

// ---------- CORS ----------

test("parseOrigins trims, drops trailing slashes and empty entries", () => {
  assert.deepEqual(parseOrigins(" https://a.app/ , ,https://b.app "), ["https://a.app", "https://b.app"]);
  assert.deepEqual(parseOrigins(undefined), []);
});

test("CORS is off when CORS_ORIGINS is not set", async () => {
  const res = await call(corsApp({}), "GET", "/thing", { origin: "https://portal.app" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("CORS echoes an allowed origin and never uses a wildcard", async () => {
  const app = corsApp({ CORS_ORIGINS: "https://portal.app,https://other.app" });
  const res = await call(app, "GET", "/thing", { origin: "https://portal.app" });
  assert.equal(res.headers.get("access-control-allow-origin"), "https://portal.app");
  assert.match(res.headers.get("vary"), /Origin/);
  assert.equal(res.headers.get("access-control-allow-credentials"), null);
});

test("CORS ignores an origin that is not on the list", async () => {
  const app = corsApp({ CORS_ORIGINS: "https://portal.app" });
  const res = await call(app, "GET", "/thing", { origin: "https://evil.app" });
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("preflight from an allowed origin gets 204 with the allowed methods and headers", async () => {
  const app = corsApp({ CORS_ORIGINS: "https://portal.app" });
  const res = await call(app, "OPTIONS", "/thing", {
    origin: "https://portal.app",
    "access-control-request-method": "POST",
    "access-control-request-headers": "authorization",
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://portal.app");
  assert.match(res.headers.get("access-control-allow-methods"), /POST/);
  assert.match(res.headers.get("access-control-allow-headers"), /Authorization/);
});

// ---------- health + preflight on the real app ----------

test("GET /health needs no token even when auth is required", async () => {
  process.env.AUTH_REQUIRED = "true";
  process.env.CORS_ORIGINS = "https://portal.app";
  const app = require("../src/app");

  const health = await call(app, "GET", "/health");
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.text), { status: "ok" });

  // ...while the API itself is still locked.
  const accounts = await call(app, "GET", "/api/v1/accounts?connectionId=x");
  assert.equal(accounts.status, 401);

  // A browser preflight carries no token, so it must not be rejected with 401.
  const preflight = await call(app, "OPTIONS", "/api/v1/accounts", {
    origin: "https://portal.app",
    "access-control-request-method": "GET",
    "access-control-request-headers": "authorization",
  });
  assert.equal(preflight.status, 204);
});

// ---------- startup config check ----------

test("checkEnv: dev with nothing set is fine and quiet", () => {
  assert.deepEqual(checkEnv({}), { errors: [], warnings: [] });
});

test("checkEnv: AUTH_REQUIRED without Supabase settings is an error", () => {
  const { errors } = checkEnv({ AUTH_REQUIRED: "true" });
  assert.equal(errors.length, 2);
  assert.match(errors.join(" "), /SUPABASE_URL/);
  assert.match(errors.join(" "), /SUPABASE_ANON_KEY/);
});

test("checkEnv: production needs DATABASE_URL and TOKEN_ENCRYPTION_KEY", () => {
  const { errors } = checkEnv({ NODE_ENV: "production", AUTH_REQUIRED: "true", SUPABASE_URL: "u", SUPABASE_ANON_KEY: "k" });
  assert.equal(errors.length, 2);
  assert.match(errors.join(" "), /DATABASE_URL/);
  assert.match(errors.join(" "), /TOKEN_ENCRYPTION_KEY/);
});

test("checkEnv: production with auth off or no CORS warns but still starts", () => {
  const { errors, warnings } = checkEnv({ NODE_ENV: "production", DATABASE_URL: "d", TOKEN_ENCRYPTION_KEY: "t" });
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 2);
});

test("checkEnv: a fully configured production env is clean, and never echoes values", () => {
  const env = {
    NODE_ENV: "production", DATABASE_URL: "postgres://secret", TOKEN_ENCRYPTION_KEY: "secretkey",
    AUTH_REQUIRED: "true", SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", CORS_ORIGINS: "https://p.app",
  };
  const { errors, warnings } = checkEnv(env);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.doesNotMatch(JSON.stringify(checkEnv({ NODE_ENV: "production", AUTH_REQUIRED: "true" })), /secret/);
});
