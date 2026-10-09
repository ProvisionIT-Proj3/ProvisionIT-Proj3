const test = require("node:test");
const assert = require("node:assert/strict");
const ProviderRegistry = require("../src/auth/core/providerRegistry");

test("registers and resolves OAuth services by an allowlisted provider id", () => {
  const xeroService = {};
  const registry = new ProviderRegistry().register("xero", xeroService);

  assert.equal(registry.get("xero"), xeroService);
  assert.equal(registry.get("quickbooks"), null);
  assert.throws(() => registry.require("quickbooks"), /Unsupported OAuth provider/);
});

test("does not allow a provider registration to be silently replaced", () => {
  const registry = new ProviderRegistry().register("xero", {});
  assert.throws(() => registry.register("xero", {}), /already registered/);
});

test("resolves the provider that owns an internal connection id", async () => {
  const registry = new ProviderRegistry()
    .register("xero", { hasConnection: async (id) => id === "xero-connection" })
    .register("quickbooks", { hasConnection: async (id) => id === "quickbooks-connection" });

  assert.equal(await registry.resolveProvider("quickbooks-connection"), "quickbooks");
  assert.equal(await registry.resolveProvider("missing"), null);
});
