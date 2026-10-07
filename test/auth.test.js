const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { inject } = require("./helpers/inject");

const CONN = "5adce2dd-1331-4700-8600-c226221d89da";

// Fakes: no real database, no OAuth config, no Supabase.
const roles = { "u-admin": "admin", "u-staff": "staff", "u-norole": null };
inject("../src/persistence.js", {
  getUserRole: async (id) => roles[id] ?? null,
  getConnectionById: async () => ({ connection_id: CONN, platform: "xero", last_synced_at: null }),
  getAccountsByConnection: async () => [],
  saveAccounts: async (c, a) => ({ saved: a.length }),
});
// Stand-in OAuth router with the same paths as the real ones, so we can check
// which of them the guard protects.
const oauth = express.Router();
oauth.get("/xero/connect", (req, res) => res.json({ ok: "connect" }));
oauth.get("/xero/callback", (req, res) => res.json({ ok: "callback" }));
oauth.get("/xero/connections", (req, res) => res.json({ ok: "list" }));
oauth.delete("/xero/connections/:id", (req, res) => res.json({ ok: "deleted" }));
inject("../src/auth/index.js", {
  registry: { resolveProvider: async () => "xero" },
  router: oauth,
});
inject("../src/connector/connectorFactory.js", {
  createConnector: () => ({ getAccounts: async () => [], getTrialBalance: async () => ({}) }),
});

const { createAuth } = require("../src/middleware/auth");

// Tokens "t-admin", "t-staff", "t-norole" are valid; anything else is rejected.
const tokenToUser = { "t-admin": "u-admin", "t-staff": "u-staff", "t-norole": "u-norole" };
async function fakeVerify(token) {
  if (token === "t-down") {
    const e = new Error("down"); e.status = 503; e.code = "AUTH_UNAVAILABLE"; throw e;
  }
  if (!tokenToUser[token]) {
    const e = new Error("bad"); e.status = 401; e.code = "INVALID_TOKEN"; throw e;
  }
  return { id: tokenToUser[token], email: `${tokenToUser[token]}@example.com` };
}

// Build a fresh copy of the app's guarded routes for a given environment.
function buildApp(env) {
  const { authenticate, requireAdmin, guardConnectionRoutes } = createAuth({
    verify: fakeVerify,
    getRole: async (id) => roles[id] ?? null,
    env,
  });
  const app = express();
  const ok = (req, res) => res.json({ ok: true, user: req.user ?? null });
  app.get("/api/v1/accounts", authenticate, ok);
  app.post("/api/v1/sync", authenticate, requireAdmin, ok);
  app.use("/auth", guardConnectionRoutes, oauth);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: { code: err.code, message: err.message } }));
  return app;
}

async function call(app, method, path, token) {
  const server = http.createServer(app).listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

// ---------- switch OFF (the default) ----------

test("auth is OFF by default: no token needed anywhere", async () => {
  const app = buildApp({});
  assert.equal((await call(app, "GET", "/api/v1/accounts")).status, 200);
  assert.equal((await call(app, "POST", "/api/v1/sync")).status, 200);
  assert.equal((await call(app, "DELETE", "/auth/xero/connections/abc")).status, 200);
});

test("AUTH_REQUIRED=false keeps it off", async () => {
  const app = buildApp({ AUTH_REQUIRED: "false" });
  assert.equal((await call(app, "GET", "/api/v1/accounts")).status, 200);
});

// ---------- switch ON ----------

const ON = { AUTH_REQUIRED: "true" };

test("no token is a 401 UNAUTHENTICATED", async () => {
  const res = await call(buildApp(ON), "GET", "/api/v1/accounts");
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, "UNAUTHENTICATED");
});

test("a bad token is a 401 INVALID_TOKEN", async () => {
  const res = await call(buildApp(ON), "GET", "/api/v1/accounts", "garbage");
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, "INVALID_TOKEN");
});

test("login service being down is a 503, not a 401", async () => {
  const res = await call(buildApp(ON), "GET", "/api/v1/accounts", "t-down");
  assert.equal(res.status, 503);
});

test("a valid user with no role is a 403 NO_ROLE", async () => {
  const res = await call(buildApp(ON), "GET", "/api/v1/accounts", "t-norole");
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, "NO_ROLE");
});

test("any role can read accounts", async () => {
  const res = await call(buildApp(ON), "GET", "/api/v1/accounts", "t-staff");
  assert.equal(res.status, 200);
  assert.equal(res.body.user.role, "staff");
});

test("only admins can sync", async () => {
  const app = buildApp(ON);
  assert.equal((await call(app, "POST", "/api/v1/sync", "t-staff")).status, 403);
  assert.equal((await call(app, "POST", "/api/v1/sync", "t-admin")).status, 200);
});

test("ADMIN_ROLE changes which role counts as admin", async () => {
  const app = buildApp({ ...ON, ADMIN_ROLE: "staff" });
  assert.equal((await call(app, "POST", "/api/v1/sync", "t-staff")).status, 200);
  assert.equal((await call(app, "POST", "/api/v1/sync", "t-admin")).status, 403);
});

// ---------- OAuth connection routes ----------

test("OAuth connect and callback stay open (the browser is redirected through them)", async () => {
  const app = buildApp(ON);
  assert.equal((await call(app, "GET", "/auth/xero/connect")).status, 200);
  assert.equal((await call(app, "GET", "/auth/xero/callback")).status, 200);
});

test("listing connections needs a login", async () => {
  const app = buildApp(ON);
  assert.equal((await call(app, "GET", "/auth/xero/connections")).status, 401);
  assert.equal((await call(app, "GET", "/auth/xero/connections", "t-staff")).status, 200);
});

test("deleting a connection needs an admin", async () => {
  const app = buildApp(ON);
  assert.equal((await call(app, "DELETE", "/auth/xero/connections/abc")).status, 401);
  assert.equal((await call(app, "DELETE", "/auth/xero/connections/abc", "t-staff")).status, 403);
  assert.equal((await call(app, "DELETE", "/auth/xero/connections/abc", "t-admin")).status, 200);
});

// ---------- misconfiguration fails closed ----------

test("AUTH_REQUIRED=true without Supabase settings fails closed with 500", async () => {
  const app = express();
  const { authenticate } = createAuth({ env: ON, getRole: async () => "admin" }); // real verifyToken
  app.get("/x", authenticate, (req, res) => res.json({ ok: true }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: { code: err.code } }));
  const saved = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_ANON_KEY };
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_ANON_KEY;
  try {
    const res = await call(app, "GET", "/x", "anything");
    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, "AUTH_NOT_CONFIGURED");
  } finally {
    if (saved.u) process.env.SUPABASE_URL = saved.u;
    if (saved.k) process.env.SUPABASE_ANON_KEY = saved.k;
  }
});

// ---------- the real app is wired up ----------

test("the real app has the guard wired in (ON)", async () => {
  const prev = process.env.AUTH_REQUIRED;
  process.env.AUTH_REQUIRED = "true";
  try {
    const app = require("../src/app");
    const res = await call(app, "GET", `/api/v1/accounts?connectionId=${CONN}`);
    assert.equal(res.status, 401);
    assert.equal((await call(app, "DELETE", "/auth/xero/connections/abc")).status, 401);
    assert.equal((await call(app, "GET", "/auth/xero/callback")).status, 200);
  } finally {
    if (prev === undefined) delete process.env.AUTH_REQUIRED; else process.env.AUTH_REQUIRED = prev;
  }
});

test("the real app is unchanged when auth is OFF", async () => {
  delete process.env.AUTH_REQUIRED;
  const app = require("../src/app");
  const res = await call(app, "GET", `/api/v1/accounts?connectionId=${CONN}`);
  assert.equal(res.status, 200);
});
