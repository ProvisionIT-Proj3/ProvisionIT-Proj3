class ProviderRegistry {
  constructor() {
    this.services = new Map();
  }

  register(providerId, service) {
    if (this.services.has(providerId)) throw new Error(`OAuth provider already registered: ${providerId}`);
    this.services.set(providerId, service);
    return this;
  }

  get(providerId) {
    return this.services.get(providerId) || null;
  }

  require(providerId) {
    const service = this.get(providerId);
    if (!service) throw new Error(`Unsupported OAuth provider: ${providerId}`);
    return service;
  }

  async resolveProvider(connectionId) {
    for (const [providerId, service] of this.services) {
      if (await service.hasConnection(connectionId)) return providerId;
    }
    return null;
  }
}

module.exports = ProviderRegistry;
