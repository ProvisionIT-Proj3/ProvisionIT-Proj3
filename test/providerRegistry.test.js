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
