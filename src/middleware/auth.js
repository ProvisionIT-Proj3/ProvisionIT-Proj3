const { createClient } = require("@supabase/supabase-js");
const persistence = require("../persistence");
const { createAuditLogger } = require("../security/auditLogger");

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

function createDefaultAuditLogger(env) {
  if (!env.DATABASE_URL || typeof persistence.writeAuditEvent !== "function") return null;
  return createAuditLogger({ persistence });
}

function getRequestMetadata(req, additional = {}) {
  return {
    method: req.method,
    path: req.path,
    ...additional,
  };
}

function getRequestId(req) {
  return typeof req.get === "function" ? req.get("x-request-id") : null;
}

function getRequestConnectionId(req) {
  return req.connectionId || req.params?.connectionId || null;
}

function createAccessControl({
  env = process.env,
  getRole = getPersistedRole,
  hasConnectionAccess = checkPersistedConnectionAccess,
  listUserConnections = listPersistedUserConnections,
  supabaseClient = null,
  clientFactory = () => createSupabaseClient(env),
  auditLogger = createDefaultAuditLogger(env),
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

  async function recordAudit(req, event) {
    if (!auditLogger) return;
    try {
      await auditLogger.record({
        requestId: getRequestId(req),
        connectionId: getRequestConnectionId(req),
        ...event,
      });
    } catch {
      // Authorization must fail or succeed based on policy, not audit storage health.
    }
  }

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
      await recordAudit(req, {
        action: "authentication.failed",
        outcome: "denied",
        errorCode: "AUTHENTICATION_REQUIRED",
        metadata: getRequestMetadata(req),
      });
      return next(httpError(
        401,
        "AUTHENTICATION_REQUIRED",
        "A Bearer access token is required.",
      ));
    }

    let authenticatedUser = null;
    try {
      authenticatedUser = await verifyAccessToken(token);
      const role = await loadUserRole(authenticatedUser.id);
      req.user = {
        id: authenticatedUser.id,
        email: authenticatedUser.email || null,
        role,
      };
      await recordAudit(req, {
        actorUserId: authenticatedUser.id,
        action: "authentication.succeeded",
        outcome: "success",
        metadata: getRequestMetadata(req, { role }),
      });
      return next();
    } catch (error) {
      await recordAudit(req, {
        actorUserId: authenticatedUser?.id,
        action: "authentication.failed",
        outcome: error.status === 401 ? "denied" : "failure",
        errorCode: error.code || "AUTHENTICATION_FAILED",
        metadata: getRequestMetadata(req),
      });
      return next(error);
    }
  }

  function requirePermission(permission) {
    return async (req, res, next) => {
      if (!isAuthRequired(env)) return next();
      if (!req.user) {
        await recordAudit(req, {
          action: "authorization.denied",
          outcome: "denied",
          errorCode: "AUTHENTICATION_REQUIRED",
          metadata: getRequestMetadata(req, { permission }),
        });
        return next(httpError(401, "AUTHENTICATION_REQUIRED", "Authentication is required."));
      }
      if (req.user.role === null) {
        await recordAudit(req, {
          actorUserId: req.user.id,
          action: "authorization.denied",
          outcome: "denied",
          errorCode: "USER_PROFILE_REQUIRED",
          metadata: getRequestMetadata(req, { permission }),
        });
        return next(httpError(
          403,
          "USER_PROFILE_REQUIRED",
          "This user does not have an access-control profile.",
        ));
      }
      if (!Object.hasOwn(rolePermissions, req.user.role) || !rolePermissions[req.user.role].includes(permission)) {
        await recordAudit(req, {
          actorUserId: req.user.id,
          action: "authorization.denied",
          outcome: "denied",
          errorCode: "INSUFFICIENT_PERMISSION",
          metadata: getRequestMetadata(req, { permission, role: req.user.role }),
        });
        return next(httpError(
          403,
          "INSUFFICIENT_PERMISSION",
          "You do not have permission to perform this action.",
        ));
      }
      await recordAudit(req, {
        actorUserId: req.user.id,
        action: "authorization.granted",
        outcome: "success",
        metadata: getRequestMetadata(req, { permission, role: req.user.role }),
      });
      return next();
    };
  }

  async function requireConnectionAccess(req, res, next) {
    if (!isAuthRequired(env)) return next();
    if (!req.user) {
      await recordAudit(req, {
        action: "connection.access.denied",
        outcome: "denied",
        errorCode: "AUTHENTICATION_REQUIRED",
        metadata: getRequestMetadata(req),
      });
      return next(httpError(401, "AUTHENTICATION_REQUIRED", "Authentication is required."));
    }
    if (req.user.role === "admin") {
      await recordAudit(req, {
        actorUserId: req.user.id,
        action: "connection.access.granted",
        outcome: "success",
        metadata: getRequestMetadata(req, { role: req.user.role }),
      });
      return next();
    }

    try {
      const allowed = await hasConnectionAccess(req.user.id, req.connectionId);
      if (allowed !== true) {
        await recordAudit(req, {
          actorUserId: req.user.id,
          action: "connection.access.denied",
          outcome: "denied",
          errorCode: "CONNECTION_NOT_FOUND",
          metadata: getRequestMetadata(req, { role: req.user.role }),
        });
        // A 404 prevents callers from using this endpoint to discover other tenants.
        return next(httpError(404, "CONNECTION_NOT_FOUND", "Accounting connection not found."));
      }
      await recordAudit(req, {
        actorUserId: req.user.id,
        action: "connection.access.granted",
        outcome: "success",
        metadata: getRequestMetadata(req, { role: req.user.role }),
      });
      return next();
    } catch {
      await recordAudit(req, {
        actorUserId: req.user.id,
        action: "connection.access.failed",
        outcome: "failure",
        errorCode: "CONNECTION_ACCESS_SERVICE_UNAVAILABLE",
        metadata: getRequestMetadata(req, { role: req.user.role }),
      });
      return next(httpError(
        503,
        "CONNECTION_ACCESS_SERVICE_UNAVAILABLE",
        "Connection access could not be verified.",
      ));
    }
  }

  async function loadAccessibleConnections(req, res, next) {
    if (!isAuthRequired(env)) return next();
    if (!req.user) {
      await recordAudit(req, {
        action: "connection.list.denied",
        outcome: "denied",
        errorCode: "AUTHENTICATION_REQUIRED",
        metadata: getRequestMetadata(req),
      });
      return next(httpError(401, "AUTHENTICATION_REQUIRED", "Authentication is required."));
    }
    if (req.user.role === "admin") {
      await recordAudit(req, {
        actorUserId: req.user.id,
        action: "connection.list.granted",
        outcome: "success",
        metadata: getRequestMetadata(req, { role: req.user.role }),
      });
      return next();
    }

    try {
      const connections = await listUserConnections(req.user.id);
      if (!Array.isArray(connections)) throw new TypeError("Expected a connection list.");
      req.accessibleConnections = connections;
      await recordAudit(req, {
        actorUserId: req.user.id,
        action: "connection.list.granted",
        outcome: "success",
        metadata: getRequestMetadata(req, {
          role: req.user.role,
          tenantCount: connections.length,
        }),
      });
      return next();
    } catch {
      await recordAudit(req, {
        actorUserId: req.user.id,
        action: "connection.list.failed",
        outcome: "failure",
        errorCode: "CONNECTION_ACCESS_SERVICE_UNAVAILABLE",
        metadata: getRequestMetadata(req, { role: req.user.role }),
      });
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
