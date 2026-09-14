require("dotenv").config();

const express = require("express");
const apiRoutes = require("./routes/api");
const app = express();
app.use(express.json());
app.use("/api/v1", apiRoutes);
// Standard error format for all failures (FR-12: handle & log failures)
app.use((err, req, res, next) => {
  console.error(err.message);
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: {
      code: err.status === 400 ? "INVALID_PARAMETER" : "SERVER_ERROR",
      message: err.message || "Something went wrong.",
    },
  });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Middleware API running on http://localhost:${PORT}`);
});
module.exports = app;
