const ALLOWED_OUTCOMES = new Set(["success", "failure", "denied"]);
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
    actorUserId: cleanText(event.actorUserId, 128),
    connectionId: cleanText(event.connectionId, 128),
    provider: cleanText(event.provider, 32),
    action,
    outcome: event.outcome,
    errorCode: cleanText(event.errorCode, 128),
    requestId: cleanText(event.requestId, 128),
    metadata: sanitizeMetadata(event.metadata),
  };
}

function createAuditLogger({ persistence, clock = () => new Date(), onWriteFailure = () => {} } = {}) {
  if (!persistence || typeof persistence.writeAuditEvent !== "function") {
    throw new TypeError("Audit logger requires persistence.writeAuditEvent(event).");
  }

  async function record(event) {
    const occurredAt = clock();
    const normalized = normalizeEvent(
      event,
      occurredAt instanceof Date ? occurredAt.toISOString() : occurredAt,
    );
    try {
      await persistence.writeAuditEvent(normalized);
      return true;
    } catch {
      onWriteFailure();
      return false;
    }
  }

  return { record };
}

module.exports = {
  ALLOWED_METADATA_FIELDS,
  createAuditLogger,
  normalizeEvent,
  sanitizeMetadata,
};
