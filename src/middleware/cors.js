// CORS, so the portal on Vercel can call the API on Railway.
//
// Off unless CORS_ORIGINS is set. Put the portal address in it (comma separated,
// no path, no trailing slash):
//   CORS_ORIGINS=https://portal.vercel.app,https://admin.example.com
// Only addresses on the list get an answer. No "*" on purpose, and no cookies
// are used (the token goes in the Authorization header) so credentials stay off.

function parseOrigins(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function createCors({ env = process.env } = {}) {
  return function cors(req, res, next) {
    const allowed = parseOrigins(env.CORS_ORIGINS);
    if (!allowed.length) return next();

    // The answer depends on the Origin header, so caches must not mix it up.
    res.vary("Origin");

    const origin = req.get("origin");
    if (!origin || !allowed.includes(origin)) return next();

    res.set("Access-Control-Allow-Origin", origin);

    // Preflight: answered here, before the auth guard, because the browser
    // sends it without the Authorization header.
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
      res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.set("Access-Control-Max-Age", "600");
      return res.status(204).end();
    }
    next();
  };
}

module.exports = { cors: createCors(), createCors, parseOrigins };
