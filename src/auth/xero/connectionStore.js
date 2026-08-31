// Development-only implementation. Replace with a durable, encrypted store before deployment.
// The database adapter must implement this contract: save(connection),
// getByConnectionId(connectionId), updateTokens(connectionId, tokens),
// deleteByConnectionId(connectionId), and list().
class XeroConnectionStore {
  constructor() {
    this.connections = new Map();
  }

  async save(connection) {
    this.connections.set(connection.connectionId, connection);
    return connection;
  }

  async getByConnectionId(connectionId) {
    return this.connections.get(connectionId) || null;
  }

  async updateTokens(connectionId, tokens) {
    const connection = await this.getByConnectionId(connectionId);
    if (!connection) return null;
    const updated = { ...connection, ...tokens };
    this.connections.set(connectionId, updated);
    return updated;
  }

  async deleteByConnectionId(connectionId) {
    return this.connections.delete(connectionId);
  }

  async list() {
    return [...this.connections.values()].map(({ accessToken, refreshToken, ...connection }) => connection);
  }
}

module.exports = XeroConnectionStore;
