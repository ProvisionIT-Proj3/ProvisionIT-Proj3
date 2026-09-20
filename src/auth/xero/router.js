const express = require("express");
const { getXeroConfig, assertXeroConfigured } = require("./config");
const OAuthStateStore = require("./stateStore");
const TestMemoryXeroConnectionStore = require("./testMemoryConnectionStore");
const XeroOAuthService = require("./service");

const router = express.Router();
const config = getXeroConfig();
const xeroOAuth = new XeroOAuthService({
  config,
  stateStore: new OAuthStateStore(),
  // Durable storage will be wired after the database owner finalises the
  // provider-neutral connection contract.
  connectionStore: new TestMemoryXeroConnectionStore(),
});

router.get("/xero/connect", (req, res, next) => {
  try {
    assertXeroConfigured(config);
    res.redirect(302, xeroOAuth.getAuthorizationUrl());
  } catch (error) {
    next(error);
  }
});

router.get("/xero/callback", async (req, res, next) => {
  try {
    assertXeroConfigured(config);
    const connections = await xeroOAuth.completeAuthorization(req.query);
    res.status(201).json({ data: { provider: "xero", connections } });
  } catch (error) {
    next(error);
  }
});

router.get("/xero/connections", async (req, res, next) => {
  try {
    res.json({ data: await xeroOAuth.listConnections() });
  } catch (error) {
    next(error);
  }
});

router.delete("/xero/connections/:connectionId", async (req, res, next) => {
  try {
    assertXeroConfigured(config);
    await xeroOAuth.disconnect(req.params.connectionId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
module.exports.xeroOAuth = xeroOAuth;
