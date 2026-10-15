const express = require("express");
const apiRoutes = require("./routes/api");
const { router: authRoutes } = require("./auth/xero");
const errorHandler = require("./middleware/errorHandler");

const app = express();
app.use(express.json());

// OAuth routes own their permission checks because callbacks must remain open
// while connection-management operations require an authenticated admin.
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1", apiRoutes);
// Xero's registered callback currently uses this non-versioned path.
app.use("/auth", authRoutes);

app.use(errorHandler);

module.exports = app;
