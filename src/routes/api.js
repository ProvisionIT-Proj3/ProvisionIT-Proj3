// Routes stay thin on purpose: login and permission checks here, the real work
// in dataService.

const express = require("express");
const router = express.Router();
const dataService = require("../services/dataService");
const persistence = require("../persistence");
const { requireConnectionId, parsePagination } = require("../services/validation");
const { createAuditLogger } = require("../security/auditLogger");
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
const readAudit = requirePermission("audit:read");

// Syncs are written to the audit log. Off when there is no database.
const auditLogger = process.env.DATABASE_URL && typeof persistence.writeAuditEvent === "function"
  ? createAuditLogger({ persistence })
  : null;

// Not awaited, so a slow audit write never holds up the response.
function recordSync(req, connectionId, error) {
  if (!auditLogger) return;
  auditLogger.record({
    actorUserId: req.user?.id,
    connectionId,
    action: error ? "sync.failed" : "sync.completed",
    outcome: error ? "failure" : "success",
    errorCode: error?.code,
    requestId: req.get("x-request-id"),
    metadata: { method: "POST", path: "/sync" },
  }).catch(() => {});
}

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
  let connectionId = null;
  try {
    connectionId = getConnectionId(req);
    const result = await dataService.syncAccounts(connectionId);
    recordSync(req, connectionId);
    res.json(result);
  } catch (error) {
    if (connectionId) recordSync(req, connectionId, error);
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

// The audit log, newest first. Admin only. Routine sign-in and permission
// checks are left out unless ?all=true.
router.get("/activity", readAudit, async (req, res, next) => {
  try {
    const { page, pageSize } = parsePagination(req.query);
    const { rows, total } = await persistence.listAuditEvents({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      includeRoutine: req.query.all === "true",
    });
    res.json({
      data: rows.map((r) => ({
        id: r.audit_id,
        occurredAt: r.occurred_at,
        action: r.action,
        outcome: r.outcome,
        errorCode: r.error_code,
        provider: r.provider,
        connectionId: r.connection_id,
        companyName: r.company_name,
        actorUserId: r.actor_user_id,
      })),
      pagination: { page, pageSize, totalItems: total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
