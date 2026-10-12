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

function createAccessControl({
  env = process.env,
  getRole = getPersistedRole,
  supabaseClient = null,
  clientFactory = () => createSupabaseClient(env),
} = {}) {
  if (typeof getRole !== "function") {
    throw new TypeError("Access control requires getRole(userId).");
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

  return { authenticate, requirePermission };
}

const accessControl = createAccessControl();

module.exports = {
  ...accessControl,
  createAccessControl,
  isAuthRequired,
  readBearerToken,
  rolePermissions,
};
