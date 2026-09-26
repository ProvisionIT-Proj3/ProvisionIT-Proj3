const express = require("express");

function toQuickBooksResponse(connection) {
  const { provider, externalConnectionId, providerAccountId, accountName, metadata, ...shared } = connection;
  return { ...shared, realmId: providerAccountId, companyName: accountName, environment: metadata?.environment };
}

function createQuickBooksRouter({ service, assertConfigured }) {
  const router = express.Router();

  router.get("/quickbooks/connect", (req, res, next) => {
    try {
      assertConfigured();
      res.redirect(302, service.getAuthorizationUrl());
    } catch (error) {
      next(error);
    }
  });

  router.get("/quickbooks/callback", async (req, res, next) => {
    try {
      assertConfigured();
      const connections = await service.completeAuthorization(req.query);
      res.status(201).json({
        data: { provider: "quickbooks", connections: connections.map(toQuickBooksResponse) },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/quickbooks/connections", async (req, res, next) => {
    try {
      const connections = await service.listConnections();
      res.json({ data: connections.map(toQuickBooksResponse) });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/quickbooks/connections/:connectionId", async (req, res, next) => {
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

module.exports = createQuickBooksRouter;
