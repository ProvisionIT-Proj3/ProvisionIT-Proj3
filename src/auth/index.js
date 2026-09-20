const express = require("express");
const OAuthService = require("./core/oauthService");
const OAuthStateStore = require("./core/stateStore");
const ProviderRegistry = require("./core/providerRegistry");
const TestMemoryConnectionStore = require("./core/testMemoryConnectionStore");
const { getXeroConfig, assertXeroConfigured } = require("./providers/xero/config");
const XeroProvider = require("./providers/xero/provider");
const createXeroRouter = require("./providers/xero/router");

function createConnectionStore(provider) {
  // Durable OAuth storage will be wired after the database owner finalises the
  // provider-neutral connection and credential contract.
  return new TestMemoryConnectionStore({ provider });
}

const config = getXeroConfig();
const xeroProvider = new XeroProvider(config);
const xeroOAuth = new OAuthService({
  provider: xeroProvider,
  stateStore: new OAuthStateStore(),
  connectionStore: createConnectionStore(xeroProvider.id),
});

const registry = new ProviderRegistry().register(xeroProvider.id, xeroOAuth);
const router = express.Router();
router.use(createXeroRouter({
  service: xeroOAuth,
  assertConfigured: () => assertXeroConfigured(config),
}));

module.exports = { router, registry, xeroOAuth };
