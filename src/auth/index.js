const express = require("express");
const OAuthService = require("./core/oauthService");
const OAuthStateStore = require("./core/stateStore");
const ProviderRegistry = require("./core/providerRegistry");
const DatabaseConnectionStore = require("./core/databaseConnectionStore");
const ConnectionPersistenceAdapter = require("./core/connectionPersistenceAdapter");
const TestMemoryConnectionStore = require("./core/testMemoryConnectionStore");
const { getQuickBooksConfig, assertQuickBooksConfigured } = require("./providers/quickbooks/config");
const QuickBooksProvider = require("./providers/quickbooks/provider");
const createQuickBooksRouter = require("./providers/quickbooks/router");
const { getXeroConfig, assertXeroConfigured } = require("./providers/xero/config");
const XeroProvider = require("./providers/xero/provider");
const createXeroRouter = require("./providers/xero/router");

function createConnectionStore(provider) {
  if (!process.env.DATABASE_URL) return new TestMemoryConnectionStore({ provider });
  const persistence = require("../persistence");
  return new DatabaseConnectionStore({
    provider,
    persistence: new ConnectionPersistenceAdapter(persistence),
  });
}

const stateStore = new OAuthStateStore();
const xeroConfig = getXeroConfig();
const xeroProvider = new XeroProvider(xeroConfig);
const xeroOAuth = new OAuthService({
  provider: xeroProvider,
  stateStore,
  connectionStore: createConnectionStore(xeroProvider.id),
});

const quickBooksConfig = getQuickBooksConfig();
const quickBooksProvider = new QuickBooksProvider(quickBooksConfig);
const quickBooksOAuth = new OAuthService({
  provider: quickBooksProvider,
  stateStore,
  connectionStore: createConnectionStore(quickBooksProvider.id),
});

const registry = new ProviderRegistry()
  .register(xeroProvider.id, xeroOAuth)
  .register(quickBooksProvider.id, quickBooksOAuth);
const router = express.Router();
router.use(createXeroRouter({
  service: xeroOAuth,
  assertConfigured: () => assertXeroConfigured(xeroConfig),
}));
router.use(createQuickBooksRouter({
  service: quickBooksOAuth,
  assertConfigured: () => assertQuickBooksConfigured(quickBooksConfig),
}));

module.exports = { router, registry, xeroOAuth, quickBooksOAuth };
