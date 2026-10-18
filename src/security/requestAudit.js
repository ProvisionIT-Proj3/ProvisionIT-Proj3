function createRequestAuditRecorder(auditLogger) {
  const batches = new WeakMap();

  return async function recordRequestAudit(req, res, event) {
    if (!auditLogger) return;
    try {
      if (typeof auditLogger.recordMany !== "function" || typeof res.once !== "function") {
        await auditLogger.record(event);
        return;
      }
      let batch = batches.get(req);
      if (!batch) {
        batch = [];
        batches.set(req, batch);
        let flushed = false;
        const flush = () => {
          if (flushed) return;
          flushed = true;
          batches.delete(req);
          void Promise.resolve().then(() => auditLogger.recordMany(batch)).catch(() => {
            console.warn("[audit] AUDIT_WRITE_FAILED: request audit batch could not be recorded.");
          });
        };
        // Closed responses need auditing too, but neither path may delay the response.
        res.once("finish", flush);
        res.once("close", flush);
      }
      batch.push(event);
    } catch {
      console.warn("[audit] AUDIT_WRITE_FAILED: request audit event could not be recorded.");
    }
  };
}

module.exports = { createRequestAuditRecorder };
