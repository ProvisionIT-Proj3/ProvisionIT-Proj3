// Checks the settings when the server starts, so a bad deploy fails straight away
// instead of on the first request. Only variable names are printed, never values.
//
// Returns { errors, warnings }. server.js exits if there are any errors.

function isTrue(value) {
  return String(value).toLowerCase() === "true";
}

function checkEnv(env = process.env) {
  const errors = [];
  const warnings = [];
  const production = env.NODE_ENV === "production";

  // Turning auth on without the Supabase settings makes every call fail.
  if (isTrue(env.AUTH_REQUIRED)) {
    for (const name of ["SUPABASE_URL", "SUPABASE_ANON_KEY"]) {
      if (!env[name]) errors.push(`AUTH_REQUIRED is true but ${name} is not set.`);
    }
  }

  if (production) {
    // Without DATABASE_URL the OAuth code silently falls back to an in-memory
    // store, so connections and tokens would vanish on every restart.
    if (!env.DATABASE_URL) errors.push("DATABASE_URL is not set (required in production).");
    if (!env.TOKEN_ENCRYPTION_KEY) errors.push("TOKEN_ENCRYPTION_KEY is not set (required in production).");

    if (!isTrue(env.AUTH_REQUIRED)) {
      warnings.push("AUTH_REQUIRED is not true: the API is open to anyone who can reach it.");
    }
    if (!env.CORS_ORIGINS) {
      warnings.push("CORS_ORIGINS is not set: a portal on another domain will be blocked by the browser.");
    }
  }

  return { errors, warnings };
}

module.exports = { checkEnv };
