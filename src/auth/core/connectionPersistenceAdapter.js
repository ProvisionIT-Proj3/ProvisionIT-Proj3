const REQUIRED_CONNECTION_METHODS = [
  "createConnection",
  "getConnectionById",
  "listConnections",
  "deleteConnection",
  "createCredential",
  "updateCredentialTokens",
  "linkConnectionToCredential",
  "getTokensForConnection",
];

function getCredentialId(value) {
  if (typeof value === "string") return value;
  return value?.credential_id ?? value?.credentialId ?? null;
}

function mergeConnectionAndCredential(connection, credential) {
  if (!connection) return null;
  if (!credential) return connection;
  return {
    ...connection,
    credential_id: getCredentialId(credential) ?? connection.credential_id,
    credential_status: credential.credential_status ?? credential.status,
    access_token: credential.access_token ?? credential.accessToken,
    refresh_token: credential.refresh_token ?? credential.refreshToken,
    token_expires_at:
      credential.token_expires_at ?? credential.expires_at ?? credential.expiresAt,
  };
}

class ConnectionPersistenceAdapter {
  constructor(persistence) {
    const missingMethods = REQUIRED_CONNECTION_METHODS.filter(
      (method) => typeof persistence?.[method] !== "function",
    );
    if (missingMethods.length) {
      throw new Error(`Connection persistence is missing required methods: ${missingMethods.join(", ")}.`);
    }
    this.persistence = persistence;
  }

  async createOAuthCredential(provider) {
    const credential = await this.persistence.createCredential({
      platform: provider,
      status: "active",
    });
    if (!getCredentialId(credential)) {
      throw new Error("createCredential() did not return a credential_id.");
    }
    return credential;
  }

  async updateOAuthCredentialTokens(credentialId, tokens) {
    return this.persistence.updateCredentialTokens(credentialId, {
      accessToken: tokens.accessTokenEncrypted,
      refreshToken: tokens.refreshTokenEncrypted,
      expiresAt: tokens.expiresAt,
      status: tokens.status,
    });
  }

  async saveOAuthConnection(connection, credentialId) {
    const created = await this.persistence.createConnection({
      connectionId: connection.connectionId,
      companyName: connection.accountName,
      platform: connection.provider,
      externalConnectionId: connection.externalConnectionId,
      externalAccountId: connection.providerAccountId,
      providerMetadata: connection.metadata,
    });
    const connectionId = created?.connection_id ?? created?.connectionId ?? connection.connectionId;
    await this.persistence.linkConnectionToCredential(connectionId, credentialId);
    return this.getOAuthConnectionById(connectionId, connection.provider);
  }

  async getOAuthConnectionById(connectionId, provider) {
    const connection = await this.persistence.getConnectionById(connectionId);
    if (!connection || (connection.platform ?? connection.provider) !== provider) return null;
    const credential = await this.persistence.getTokensForConnection(connectionId);
    return mergeConnectionAndCredential(connection, credential);
  }

  async deleteOAuthConnection(connectionId, provider) {
    const existing = await this.persistence.getConnectionById(connectionId);
    if (!existing || (existing.platform ?? existing.provider) !== provider) return { deleted: false };
    return this.persistence.deleteConnection(connectionId);
  }

  async listOAuthConnections(provider) {
    const rows = (await this.persistence.listConnections())
      .filter((row) => (row.platform ?? row.provider) === provider);
    return Promise.all(rows.map(async (row) => {
      const connectionId = row.connection_id ?? row.connectionId;
      const credential = await this.persistence.getTokensForConnection(connectionId);
      return mergeConnectionAndCredential(row, credential);
    }));
  }
}

ConnectionPersistenceAdapter.getCredentialId = getCredentialId;

module.exports = ConnectionPersistenceAdapter;
