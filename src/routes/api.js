const express = require("express");
const router = express.Router();
const dataService = require("../services/dataService");
const persistence = require("../persistence");
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

// Connected companies for the admin portal. No tokens, only display fields.
router.get("/connections", async (req, res, next) => {
  try {
    const rows = await persistence.listConnections();
    res.json({
      data: rows.map((r) => ({
        connectionId: r.connection_id,
        companyName: r.company_name,
        platform: r.platform,
        status: r.status,
        dateConnected: r.date_connected,
        lastSyncedAt: r.last_synced_at,
      })),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
