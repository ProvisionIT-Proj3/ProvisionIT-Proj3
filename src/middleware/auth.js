// Access control for the API. ALL of the "who is calling?" logic lives here.
//
// Switch: AUTH_REQUIRED=true turns it on. It is OFF by default, so merging this
// changes nothing until the portal is sending tokens.
//
// When ON, callers must send  Authorization: Bearer <Supabase access token>.
// The token is checked with Supabase (auth.getUser), then the user's role is
// read from user_profiles. Roles:
//   - any role              can read (GET accounts, trial balance, connections list)
//   - ADMIN_ROLE ("admin")  can also sync and delete connections
//
// To change how tokens are checked (different login system, API key, ...),
// replace verifyToken() below. Nothing else needs to change.

const persistence = require("../persistence");

function httpError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function isAuthRequired(env = process.env) {
  return String(env.AUTH_REQUIRED).toLowerCase() === "true";
}

// ---- how a token is checked (swap this out if the login system changes) ----

let supabaseClient;
function getSupabase(env = process.env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw httpError(500, "AUTH_NOT_CONFIGURED", "AUTH_REQUIRED is on but SUPABASE_URL / SUPABASE_ANON_KEY are not set.");
  }
  if (!supabaseClient) {
    const { createClient } = require("@supabase/supabase-js");
    supabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return supabaseClient;
}

// Returns { id, email } for a valid token, or throws a 401 / 503.
async function verifyToken(token) {
  const { data, error } = await getSupabase().auth.getUser(token);
  if (error && error.name === "AuthRetryableFetchError") {
    throw httpError(503, "AUTH_UNAVAILABLE", "Could not reach the login service. Try again.");
  }
  if (error || !data || !data.user) {
    throw httpError(401, "INVALID_TOKEN", "Invalid or expired token.");
  }
  return { id: data.user.id, email: data.user.email };
}

// ---- middleware ----

function createAuth({ verify = verifyToken, getRole = persistence.getUserRole, env = process.env } = {}) {
  const adminRole = () => env.ADMIN_ROLE || "admin";

  async function authenticate(req, res, next) {
    try {
      if (!isAuthRequired(env)) return next();

      const match = /^Bearer (.+)$/i.exec(req.get("authorization") || "");
      if (!match) throw httpError(401, "UNAUTHENTICATED", "Missing bearer token.");

      const user = await verify(match[1].trim());
      const role = await getRole(user.id);
      if (!role) throw httpError(403, "NO_ROLE", "This user has no role assigned.");

      req.user = { ...user, role };
      next();
    } catch (err) {
      next(err);
    }
  }

  function requireAdmin(req, res, next) {
    if (!isAuthRequired(env)) return next();
    if (!req.user || req.user.role !== adminRole()) {
      return next(httpError(403, "FORBIDDEN", "Admin role required."));
    }
    next();
  }

  // Guards the OAuth connection-management routes without editing the OAuth
  // routers: GET .../connections needs a login, DELETE .../connections/:id needs
  // an admin. connect and callback stay open on purpose (the browser is
  // redirected through them, so it cannot send a bearer header).
  const CONNECTIONS_PATH = /^\/[^/]+\/connections(\/|$)/;
  function guardConnectionRoutes(req, res, next) {
    if (!CONNECTIONS_PATH.test(req.path)) return next();
    authenticate(req, res, (err) => {
      if (err) return next(err);
      if (req.method === "DELETE") return requireAdmin(req, res, next);
      next();
    });
  }

  return { authenticate, requireAdmin, guardConnectionRoutes };
}

module.exports = { ...createAuth(), createAuth, isAuthRequired };
