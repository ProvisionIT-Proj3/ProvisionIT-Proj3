const crypto = require("crypto");

class OAuthStateStore {
  constructor({ ttlMs = 10 * 60 * 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.states = new Map();
  }

  create(metadata = {}) {
    this.removeExpired();
    const state = crypto.randomBytes(32).toString("base64url");
    this.states.set(state, { ...metadata, expiresAt: Date.now() + this.ttlMs });
    return state;
  }

  consume(state) {
    const record = this.states.get(state);
    this.states.delete(state); // States are single use, including failed attempts.
    if (!record || record.expiresAt < Date.now()) return null;
    return record;
  }

  removeExpired() {
    const now = Date.now();
    for (const [state, record] of this.states) {
      if (record.expiresAt < now) this.states.delete(state);
    }
  }
}

module.exports = OAuthStateStore;
