const express = require("express");
const { getXeroConfig, assertXeroConfigured } = require("./config");
const OAuthStateStore = require("./stateStore");
const XeroConnectionStore = require("./connectionStore");
const XeroOAuthService = require("./service");

const router = express.Router();
const config = getXeroConfig();
const xeroOAuth = new XeroOAuthService({
  config,
  stateStore: new OAuthStateStore(),
  connectionStore: new XeroConnectionStore(),
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

router.get("/xero/connections", (req, res) => {
  res.json({ data: xeroOAuth.listConnections() });
});

module.exports = router;
