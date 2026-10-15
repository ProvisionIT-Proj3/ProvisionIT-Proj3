const express = require("express");

function toXeroResponse(connection) {
  const {
    provider,
    externalConnectionId,
    providerAccountId,
    accountName,
    metadata,
    ...shared
  } = connection;
  return {
    ...shared,
    tenantId: providerAccountId,
    tenantName: accountName,
    tenantType: metadata?.tenantType,
  };
}

function createXeroRouter({ service, assertConfigured, authenticate, requirePermission }) {
  const router = express.Router();
  const manageConnections = requirePermission("connections:manage");
  const readConnections = requirePermission("connections:read");

  router.get("/xero/connect", authenticate, manageConnections, (req, res, next) => {
    try {
      assertConfigured();
      const authorizationUrl = service.getAuthorizationUrl({ actorUserId: req.user?.id });
      if ((req.get("accept") || "").includes("application/json")) {
        return res.json({ data: { authorizationUrl } });
      }
      return res.redirect(302, authorizationUrl);
    } catch (error) {
      return next(error);
    }
  });

  router.get("/xero/callback", async (req, res, next) => {
    try {
      assertConfigured();
      const connections = await service.completeAuthorization(req.query);
      res.status(201).json({
        data: { provider: "xero", connections: connections.map(toXeroResponse) },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/xero/connections", authenticate, readConnections, async (req, res, next) => {
    try {
      const connections = await service.listConnections();
      res.json({ data: connections.map(toXeroResponse) });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/xero/connections/:connectionId", authenticate, manageConnections, async (req, res, next) => {
    try {
      assertConfigured();
      await service.disconnect(req.params.connectionId, { actorUserId: req.user?.id });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = createXeroRouter;
