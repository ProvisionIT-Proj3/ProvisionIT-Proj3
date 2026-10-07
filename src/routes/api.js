const express = require("express");
const router = express.Router();
const dataService = require("../services/dataService");
const { requireConnectionId } = require("../services/validation");
const { authenticate, requireAdmin } = require("../middleware/auth");

// Every API route needs a login when AUTH_REQUIRED=true (no-op otherwise).
router.use(authenticate);

function getConnectionId(req) {
  return requireConnectionId(req.query.connectionId);
}

// Stored accounts, in report order. Optional ?page= and ?pageSize=.
router.get("/accounts", async (req, res, next) => {
  try {
    const connectionId = getConnectionId(req);
    res.json(await dataService.getAccounts(connectionId, req.query));
  } catch (error) {
    next(error);
  }
});

// Fetch accounts from the accounting system and store them. Admin only.
router.post("/sync", requireAdmin, async (req, res, next) => {
  try {
    const connectionId = getConnectionId(req);
    res.json(await dataService.syncAccounts(connectionId));
  } catch (error) {
    next(error);
  }
});

router.get("/trial-balance", async (req, res, next) => {
  try {
    const connectionId = getConnectionId(req);
    res.json(await dataService.getTrialBalance(connectionId));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
