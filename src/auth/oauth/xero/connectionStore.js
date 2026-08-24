// Development-only implementation. Replace with a durable, encrypted store before deployment.
class XeroConnectionStore {
  constructor() {
    this.connections = new Map();
  }

  save(connection) {
    this.connections.set(connection.tenantId, connection);
    return connection;
  }

  list() {
    return [...this.connections.values()].map(({ accessToken, refreshToken, ...connection }) => connection);
  }
}

module.exports = XeroConnectionStore;
