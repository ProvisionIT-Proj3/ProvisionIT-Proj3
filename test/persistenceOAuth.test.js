const test = require("node:test");
const assert = require("node:assert/strict");

const pgPath = require.resolve("pg");
const persistencePath = require.resolve("../src/persistence");

function loadPersistence() {
  const calls = [];
  const poolOptions = [];

  class FakePool {
    constructor(options) { poolOptions.push(options); }
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
    poolOptions,
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

test("audit batches use one parameterized insert and a bounded separate pool", async () => {
  const loaded = loadPersistence();
  try {
    const events = [{
      auditId: "11111111-1111-4111-8111-111111111111",
      occurredAt: "2026-10-18T00:00:00.000Z",
      action: "authorization.granted", outcome: "success", metadata: {},
    }, {
      auditId: "22222222-2222-4222-8222-222222222222",
      occurredAt: "2026-10-18T00:00:00.000Z",
      action: "connection.access.granted", outcome: "success", metadata: {},
    }];
    await loaded.persistence.writeAuditEvents(events);
    assert.equal(loaded.calls.length, 1);
    assert.deepEqual(JSON.parse(loaded.calls[0].params[0]), events);
    assert.match(loaded.calls[0].sql, /jsonb_to_recordset\(\$1::jsonb\)/);
    assert.match(loaded.calls[0].sql, /ON CONFLICT \(audit_id\) DO NOTHING/);
    assert.equal(loaded.poolOptions[1].max, 2);
    assert.equal(loaded.poolOptions[1].query_timeout, 2000);
    assert.equal(loaded.poolOptions[1].connectionTimeoutMillis, 2000);
    await loaded.persistence.writeAuditEvents([]);
    assert.equal(loaded.calls.length, 1);
  } finally {
    loaded.restore();
  }
});

test("single-event audit inserts preserve the supplied ID for safe retries", async () => {
  const loaded = loadPersistence();
  try {
    const auditId = "11111111-1111-4111-8111-111111111111";
    await loaded.persistence.writeAuditEvent({ auditId, action: "oauth.failed", outcome: "failure" });
    assert.equal(loaded.calls[0].params[9], auditId);
    assert.match(loaded.calls[0].sql, /ON CONFLICT \(audit_id\) DO NOTHING/);
  } finally {
    loaded.restore();
  }
});
