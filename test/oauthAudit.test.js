const test = require("node:test");
const assert = require("node:assert/strict");
const OAuthService = require("../src/auth/core/oauthService");
const OAuthStateStore = require("../src/auth/core/stateStore");

function createService({ exchangeError = null } = {}) {
  const events = [];
  let issuedState;
  const provider = {
    id: "xero",
    getAuthorizationUrl(state) {
      issuedState = state;
      return `https://login.example/authorize?state=${state}`;
    },
    async exchangeAuthorizationCode() {
      if (exchangeError) throw exchangeError;
      return { access_token: "access-secret", refresh_token: "refresh-secret", expires_in: 3600 };
    },
    async discoverAccounts() {
      return [
        { providerAccountId: "tenant-1", accountName: "Company One" },
        { providerAccountId: "tenant-2", accountName: "Company Two" },
      ];
    },
  };
  let nextId = 1;
  const service = new OAuthService({
    provider,
    stateStore: new OAuthStateStore(),
    connectionStore: {
      async saveAuthorization(connections) {
        return connections;
      },
    },
    idFactory: () => `connection-${nextId++}`,
    auditLogger: {
      async record(event) {
        events.push(event);
      },
    },
  });
  return { events, getIssuedState: () => issuedState, service };
}

test("successful multi-company authorization records safe audit events", async () => {
  const { events, getIssuedState, service } = createService();
  service.getAuthorizationUrl({ actorUserId: "admin-user" });

  const connections = await service.completeAuthorization({
    code: "one-time-code",
    state: getIssuedState(),
  });

  assert.equal(connections.length, 2);
  assert.deepEqual(events, [
    {
      provider: "xero",
      actorUserId: "admin-user",
      action: "oauth.completed",
      outcome: "success",
      metadata: { connectionCount: 2 },
    },
    {
      provider: "xero",
      actorUserId: "admin-user",
      connectionId: "connection-1",
      action: "connection.created",
      outcome: "success",
    },
    {
      provider: "xero",
      actorUserId: "admin-user",
      connectionId: "connection-2",
      action: "connection.created",
      outcome: "success",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(events), /access-secret|refresh-secret|one-time-code/);
});

test("failed authorization records an error code without secrets", async () => {
  const exchangeError = Object.assign(new Error("provider returned secret details"), {
    code: "XERO_TOKEN_EXCHANGE_FAILED",
  });
  const { events, getIssuedState, service } = createService({ exchangeError });
  service.getAuthorizationUrl({ actorUserId: "admin-user" });

  await assert.rejects(
    service.completeAuthorization({ code: "secret-code", state: getIssuedState() }),
    /provider returned secret details/,
  );

  assert.deepEqual(events, [{
    provider: "xero",
    actorUserId: "admin-user",
    action: "oauth.failed",
    outcome: "failure",
    errorCode: "XERO_TOKEN_EXCHANGE_FAILED",
  }]);
  assert.doesNotMatch(JSON.stringify(events), /secret-code|secret details/);
});

test("disconnect audit retains the trusted actor on success and failure", async () => {
  for (const outcome of ["success", "failure"]) {
    const { service, events } = createService();
    service.connectionStore.getByConnectionId = async () => ({
      provider: "xero", connectionId: "connection-1", expiresAt: "2099-01-01T00:00:00.000Z",
    });
    service.connectionStore.deleteByConnectionId = async () => {};
    service.provider.disconnect = async () => {
      if (outcome === "failure") throw new Error("private provider details");
    };
    const operation = service.disconnect("connection-1", { actorUserId: "admin-user" });
    if (outcome === "failure") await assert.rejects(operation, /private provider details/);
    else await operation;

    assert.equal(events.length, 1);
    assert.equal(events[0].actorUserId, "admin-user");
    assert.equal(events[0].connectionId, "connection-1");
    assert.equal(events[0].outcome, outcome);
    assert.doesNotMatch(JSON.stringify(events), /private provider details/);
  }
});
