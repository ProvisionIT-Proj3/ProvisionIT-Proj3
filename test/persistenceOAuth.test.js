const test = require("node:test");
const assert = require("node:assert/strict");

const pgPath = require.resolve("pg");
const persistencePath = require.resolve("../src/persistence");

function loadPersistence() {
  const calls = [];

  class FakePool {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ connection_id: "connection-1", credential_id: "credential-1" }] };
    }
  }

  const originalPg = require.cache[pgPath];
  require.cache[pgPath] = {
    id: pgPath,
    filename: pgPath,
    loaded: true,
    exports: {
      Pool: FakePool,
      types: { setTypeParser() {} },
    },
  };
  delete require.cache[persistencePath];
  const persistence = require(persistencePath);

  return {
    calls,
    persistence,
    restore() {
      delete require.cache[persistencePath];
      if (originalPg) require.cache[pgPath] = originalPg;
      else delete require.cache[pgPath];
    },
  };
}

test("connection persistence keeps all provider identifiers and metadata", async () => {
  const loaded = loadPersistence();
  try {
    await loaded.persistence.createConnection({
      companyName: "Example Company",
      platform: "xero",
      externalConnectionId: "xero-connection-1",
      externalAccountId: "xero-tenant-1",
      providerMetadata: { tenantType: "ORGANISATION" },
    });
    await loaded.persistence.linkConnectionToCredential("connection-1", "credential-1");

    assert.match(loaded.calls[0].sql, /external_connection_id/);
    assert.match(loaded.calls[0].sql, /provider_metadata/);
    assert.deepEqual(loaded.calls[0].params, [
      "Example Company",
      "xero",
      "xero-connection-1",
      "xero-tenant-1",
      { tenantType: "ORGANISATION" },
    ]);
    assert.doesNotMatch(loaded.calls[1].sql, /external_account_id\s*=/);
    assert.deepEqual(loaded.calls[1].params, ["credential-1", "connection-1"]);
  } finally {
    loaded.restore();
  }
});

test("credential persistence stores and reads reauthorization status", async () => {
  const loaded = loadPersistence();
  try {
    await loaded.persistence.createCredential({
      platform: "quickbooks",
      status: "active",
    });
    await loaded.persistence.updateCredentialTokens("credential-1", {
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      status: "reauthorization_required",
    });
    await loaded.persistence.getTokensForConnection("connection-1");

    assert.match(loaded.calls[0].sql, /status/);
    assert.equal(loaded.calls[0].params.at(-1), "active");
    assert.match(loaded.calls[1].sql, /status = \$4/);
    assert.equal(loaded.calls[1].params[3], "reauthorization_required");
    assert.match(loaded.calls[2].sql, /oc\.status AS credential_status/);
  } finally {
    loaded.restore();
  }
});
