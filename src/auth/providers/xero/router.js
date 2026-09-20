const express = require("express");

function toXeroResponse(connection) {
  const {
    provider,
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

function createXeroRouter({ service, assertConfigured }) {
  const router = express.Router();

  router.get("/xero/connect", (req, res, next) => {
    try {
      assertConfigured();
      res.redirect(302, service.getAuthorizationUrl());
    } catch (error) {
      next(error);
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

  router.get("/xero/connections", async (req, res, next) => {
    try {
      const connections = await service.listConnections();
      res.json({ data: connections.map(toXeroResponse) });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/xero/connections/:connectionId", async (req, res, next) => {
    try {
      assertConfigured();
      await service.disconnect(req.params.connectionId);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = createXeroRouter;
