const express = require("express");
const apiRoutes = require("./routes/api");
const { router: authRoutes } = require("./auth/xero");
const errorHandler = require("./middleware/errorHandler");
const { cors } = require("./middleware/cors");

const app = express();

// Liveness check for the host (Railway). No auth and no database call, so it
// stays up even when login or the database is down.
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Before everything else so preflight requests are answered without a token.
app.use(cors);
app.use(express.json());

// OAuth routes own their permission checks because callbacks must remain open
// while connection-management operations require an authenticated admin.
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1", apiRoutes);
// Xero's registered callback currently uses this non-versioned path.
app.use("/auth", authRoutes);

app.use(errorHandler);

module.exports = app;
