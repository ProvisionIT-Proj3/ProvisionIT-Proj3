const express = require("express");
const apiRoutes = require("./routes/api");
const { router: authRoutes } = require("./auth/xero");
const { guardConnectionRoutes } = require("./middleware/auth");
const { cors } = require("./middleware/cors");

const app = express();

// Liveness check for the host (Railway). No auth and no database call, so it
// stays up even when login or the database is down.
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Before everything else so preflight requests are answered without a token.
app.use(cors);
app.use(express.json());

// Mounted before /api/v1 so these routes (and guardConnectionRoutes' open
// /connect and /callback) are matched first — otherwise apiRoutes' blanket
// authenticate middleware would run first for anything under /api/v1/auth.
app.use("/api/v1/auth", guardConnectionRoutes, authRoutes);
app.use("/api/v1", apiRoutes);
// Xero's registered callback currently uses this non-versioned path.
app.use("/auth", guardConnectionRoutes, authRoutes);

// Standard error format for all failures (FR-12: handle & log failures)
app.use((err, req, res, next) => {
  console.error(err.message); // placeholder logging — replace with real logger in Sprint 3
  res.status(err.status || 500).json({
    error: {
      code: err.code || (err.status === 400 ? "INVALID_PARAMETER" : "SERVER_ERROR"),
      message: err.message || "Something went wrong.",
    },
  });
});

module.exports = app;
