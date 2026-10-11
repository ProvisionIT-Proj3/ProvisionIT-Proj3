// CORS for a portal that is hosted on a different origin than the API
// (e.g. https://portal.vercel.app calling https://api.up.railway.app).
//
// OFF by default: with CORS_ORIGINS unset no CORS headers are sent, which is
// exactly how the API behaved before (the dev server uses a proxy instead).
//
// CORS_ORIGINS is a comma separated allow list of exact origins, no paths:
//   CORS_ORIGINS=https://portal.vercel.app,https://admin.example.com
// Only origins on the list are echoed back. There is no "*" on purpose.
// Auth uses a bearer header, not cookies, so credentials are never allowed.

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
