const { randomUUID } = require("node:crypto");

const pendingWrites = new Set();
const ALLOWED_OUTCOMES = new Set(["success", "failure", "denied"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_METADATA_FIELDS = new Set([
  "connectionCount",
  "method",
  "path",
  "permission",
  "role",
  "source",
  "statusCode",
  "tenantCount",
]);

function cleanText(value, maxLength) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function cleanMetadataValue(value) {
  if (typeof value === "string") return value.slice(0, 200);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return undefined;
}

function cleanUuid(value) {
  // An invalid request ID must not prevent a denied request from being audited.
  return typeof value === "string" && uuidPattern.test(value) ? value : null;
}

function reportWriteFailure() {
  console.warn("[audit] AUDIT_WRITE_FAILED: security audit events could not be saved after retry.");
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const sanitized = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!ALLOWED_METADATA_FIELDS.has(key)) continue;
    const cleanValue = cleanMetadataValue(value);
    if (cleanValue !== undefined) sanitized[key] = cleanValue;
  }
  return sanitized;
}

function normalizeEvent(event, occurredAt) {
  const action = cleanText(event?.action, 80);
  if (!action || !/^[a-z][a-z0-9_.-]*$/.test(action)) {
    throw new TypeError("Audit action must use a lowercase dotted identifier.");
  }
  if (!ALLOWED_OUTCOMES.has(event.outcome)) {
    throw new TypeError("Audit outcome must be success, failure, or denied.");
  }

  return {
    occurredAt,
    actorUserId: cleanUuid(event.actorUserId),
    connectionId: cleanUuid(event.connectionId),
    provider: cleanText(event.provider, 32),
    action,
    outcome: event.outcome,
    errorCode: cleanText(event.errorCode, 128),
    requestId: cleanText(event.requestId, 128),
    metadata: sanitizeMetadata(event.metadata),
  };
}

function createAuditLogger({ persistence, clock = () => new Date(), onWriteFailure = reportWriteFailure } = {}) {
  if (!persistence || typeof persistence.writeAuditEvent !== "function") {
    throw new TypeError("Audit logger requires persistence.writeAuditEvent(event).");
  }

  async function writeBatch(events) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        if (typeof persistence.writeAuditEvents === "function") {
          await persistence.writeAuditEvents(events);
        } else {
          for (const event of events) await persistence.writeAuditEvent(event);
        }
        return true;
      } catch {
        // Reuse event IDs because the database may have committed before a lost reply.
      }
    }
    try {
      onWriteFailure({ code: "AUDIT_WRITE_FAILED", eventCount: events.length, attempts: 2 });
    } catch {
      reportWriteFailure();
    }
    return false;
  }

  function recordMany(events) {
    const normalized = events.map((event) => {
      const occurredAt = clock();
      return {
        ...normalizeEvent(event, occurredAt instanceof Date ? occurredAt.toISOString() : occurredAt),
        auditId: randomUUID(),
      };
    });
    if (!normalized.length) return Promise.resolve(true);
    const pending = writeBatch(normalized);
    pendingWrites.add(pending);
    pending.finally(() => pendingWrites.delete(pending));
    return pending;
  }

  async function record(event) {
    return recordMany([event]);
  }

  return { record, recordMany };
}

async function waitForAuditWrites() {
  // Response finish handlers schedule their writes in the next microtask.
  await Promise.resolve();
  while (pendingWrites.size) await Promise.allSettled([...pendingWrites]);
}

module.exports = {
  ALLOWED_METADATA_FIELDS,
  createAuditLogger,
  normalizeEvent,
  sanitizeMetadata,
  waitForAuditWrites,
};
