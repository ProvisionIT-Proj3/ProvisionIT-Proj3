const { createClient } = require("@supabase/supabase-js");
const persistence = require("../persistence");

const rolePermissions = Object.freeze({
  admin: Object.freeze([
    "accounting:read",
    "accounting:sync",
    "connections:read",
    "connections:manage",
  ]),
  user: Object.freeze(["accounting:read"]),
});

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function isAuthRequired(env = process.env) {
  return String(env.AUTH_REQUIRED).toLowerCase() === "true";
}

function readBearerToken(authorization) {
  if (typeof authorization !== "string") return null;
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] || null;
}

function createSupabaseClient(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw httpError(
      500,
      "AUTH_CONFIGURATION_ERROR",
      "Supabase authentication is not configured.",
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function getPersistedRole(userId) {
  if (typeof persistence.getUserRole !== "function") {
    throw new Error("Role persistence is unavailable.");
  }
  return persistence.getUserRole(userId);
}

function checkPersistedConnectionAccess(userId, connectionId) {
  if (typeof persistence.hasUserConnectionAccess !== "function") {
    throw new Error("Connection access persistence is unavailable.");
  }
  return persistence.hasUserConnectionAccess(userId, connectionId);
}

function listPersistedUserConnections(userId) {
  if (typeof persistence.listConnectionsForUser !== "function") {
    throw new Error("Connection access persistence is unavailable.");
  }
  return persistence.listConnectionsForUser(userId);
}

function createAccessControl({
  env = process.env,
  getRole = getPersistedRole,
  hasConnectionAccess = checkPersistedConnectionAccess,
  listUserConnections = listPersistedUserConnections,
  supabaseClient = null,
  clientFactory = () => createSupabaseClient(env),
} = {}) {
  if (typeof getRole !== "function") {
    throw new TypeError("Access control requires getRole(userId).");
  }
  if (typeof hasConnectionAccess !== "function" || typeof listUserConnections !== "function") {
    throw new TypeError("Access control requires connection access persistence methods.");
  }

  let client = supabaseClient;
  const getClient = () => {
    client ||= clientFactory();
    return client;
  };

  async function verifyAccessToken(token) {
    let authClient;
    try {
      authClient = getClient();
    } catch (error) {
      if (error.code === "AUTH_CONFIGURATION_ERROR") throw error;
      throw httpError(
        503,
        "AUTHENTICATION_SERVICE_UNAVAILABLE",
        "The authentication service is unavailable.",
      );
    }

    let result;
    try {
      result = await authClient.auth.getUser(token);
    } catch {
      throw httpError(
        503,
        "AUTHENTICATION_SERVICE_UNAVAILABLE",
        "The authentication service is unavailable.",
      );
    }

    if (result.error?.name === "AuthRetryableFetchError") {
      throw httpError(
        503,
        "AUTHENTICATION_SERVICE_UNAVAILABLE",
        "The authentication service is unavailable.",
      );
    }
    if (result.error || !result.data?.user?.id) {
      throw httpError(401, "INVALID_ACCESS_TOKEN", "The access token is invalid or expired.");
    }
    return result.data.user;
  }

  async function loadUserRole(userId) {
    try {
      return await getRole(userId);
    } catch {
      throw httpError(
        503,
        "AUTHORIZATION_SERVICE_UNAVAILABLE",
        "The user access profile could not be loaded.",
      );
    }
  }

  async function authenticate(req, res, next) {
    if (!isAuthRequired(env)) return next();

    const token = readBearerToken(req.get("authorization"));
    if (!token) {
      return next(httpError(
        401,
        "AUTHENTICATION_REQUIRED",
        "A Bearer access token is required.",
      ));
    }

    try {
      const user = await verifyAccessToken(token);
      const role = await loadUserRole(user.id);
      req.user = { id: user.id, email: user.email || null, role };
      return next();
    } catch (error) {
      return next(error);
    }
  }

  function requirePermission(permission) {
    return (req, res, next) => {
      if (!isAuthRequired(env)) return next();
      if (!req.user) {
        return next(httpError(401, "AUTHENTICATION_REQUIRED", "Authentication is required."));
      }
      if (req.user.role === null) {
        return next(httpError(
          403,
          "USER_PROFILE_REQUIRED",
          "This user does not have an access-control profile.",
        ));
      }
      if (!rolePermissions[req.user.role]?.includes(permission)) {
        return next(httpError(
          403,
          "INSUFFICIENT_PERMISSION",
          "You do not have permission to perform this action.",
        ));
      }
      return next();
    };
  }

  async function requireConnectionAccess(req, res, next) {
    if (!isAuthRequired(env) || req.user?.role === "admin") return next();
    if (!req.user) {
      return next(httpError(401, "AUTHENTICATION_REQUIRED", "Authentication is required."));
    }

    try {
      const allowed = await hasConnectionAccess(req.user.id, req.connectionId);
      if (allowed !== true) {
        // A 404 prevents callers from using this endpoint to discover other tenants.
        return next(httpError(404, "CONNECTION_NOT_FOUND", "Accounting connection not found."));
      }
      return next();
    } catch {
      return next(httpError(
        503,
        "CONNECTION_ACCESS_SERVICE_UNAVAILABLE",
        "Connection access could not be verified.",
      ));
    }
  }

  async function loadAccessibleConnections(req, res, next) {
    if (!isAuthRequired(env) || req.user?.role === "admin") return next();
    if (!req.user) {
      return next(httpError(401, "AUTHENTICATION_REQUIRED", "Authentication is required."));
    }

    try {
      const connections = await listUserConnections(req.user.id);
      if (!Array.isArray(connections)) throw new TypeError("Expected a connection list.");
      req.accessibleConnections = connections;
      return next();
    } catch {
      return next(httpError(
        503,
        "CONNECTION_ACCESS_SERVICE_UNAVAILABLE",
        "Connection access could not be loaded.",
      ));
    }
  }

  return {
    authenticate,
    loadAccessibleConnections,
    requireConnectionAccess,
    requirePermission,
  };
}

const accessControl = createAccessControl();

module.exports = {
  ...accessControl,
  createAccessControl,
  isAuthRequired,
  readBearerToken,
  rolePermissions,
};
