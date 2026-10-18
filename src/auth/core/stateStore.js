const crypto = require("node:crypto");

class OAuthStateStore {
  constructor({ ttlMs = 10 * 60 * 1000, clock = Date.now } = {}) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError("OAuth state TTL must be positive.");
    this.ttlMs = ttlMs;
    this.clock = clock;
    this.states = new Map();
  }

  create(metadata = {}) {
    this.removeExpired();
    const state = crypto.randomBytes(32).toString("base64url");
    this.states.set(state, { ...metadata, expiresAt: this.clock() + this.ttlMs });
    return state;
  }

  consume(state) {
    if (typeof state !== "string") return null;
    const record = this.states.get(state);
    this.states.delete(state);
    if (!record || record.expiresAt <= this.clock()) return null;
    return record;
  }

  removeExpired() {
    const now = this.clock();
    for (const [state, record] of this.states) {
      if (record.expiresAt <= now) this.states.delete(state);
    }
  }
}

module.exports = OAuthStateStore;
