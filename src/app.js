const express = require("express");
const apiRoutes = require("./routes/api");
const authRoutes = require("./auth/oauth/xero/router");

const app = express();
app.use(express.json());

app.use("/api/v1", apiRoutes);
app.use("/api/v1/auth", authRoutes);
// Xero's registered callback currently uses this non-versioned path.
app.use("/auth", authRoutes);

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Middleware API running on http://localhost:${PORT}`);
});

module.exports = app;
