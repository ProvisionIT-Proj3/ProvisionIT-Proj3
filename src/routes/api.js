// Routes stay thin on purpose: login and permission checks here, the real work
// in dataService.

const express = require("express");
const router = express.Router();
const dataService = require("../services/dataService");
const persistence = require("../persistence");
const { requireConnectionId } = require("../services/validation");
const {
  authenticate,
  loadAccessibleConnections,
  requireConnectionAccess,
  requirePermission,
} = require("../middleware/auth");

// Every API route needs a login when AUTH_REQUIRED=true (no-op otherwise).
router.use(authenticate);
const readAccounting = requirePermission("accounting:read");
const syncAccounting = requirePermission("accounting:sync");

function getConnectionId(req) {
  return requireConnectionId(req.query.connectionId);
}

function loadConnectionId(req, res, next) {
  try {
    req.connectionId = getConnectionId(req);
    return next();
  } catch (error) {
    return next(error);
  }
}

// Stored accounts, in report order. Optional ?page= and ?pageSize=.
router.get("/accounts", readAccounting, loadConnectionId, requireConnectionAccess, async (req, res, next) => {
  try {
    res.json(await dataService.getAccounts(req.connectionId, req.query));
  } catch (error) {
    next(error);
  }
});

// Fetch accounts from the accounting system and store them. Admin only.
router.post("/sync", syncAccounting, async (req, res, next) => {
  try {
    const connectionId = getConnectionId(req);
    res.json(await dataService.syncAccounts(connectionId));
  } catch (error) {
    next(error);
  }
});

// Live trial balance from the accounting system. Same canonical shape as
// /accounts, but fetched on each request and not stored.
router.get("/trial-balance", readAccounting, loadConnectionId, requireConnectionAccess, async (req, res, next) => {
  try {
    res.json(await dataService.getTrialBalance(req.connectionId));
  } catch (error) {
    next(error);
  }
});

// Connected companies for the admin portal. No tokens, only display fields.
router.get("/connections", readAccounting, loadAccessibleConnections, async (req, res, next) => {
  try {
    const rows = req.user?.role === "user"
      ? req.accessibleConnections
      : await persistence.listConnections();
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
