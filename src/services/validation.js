// Request validation shared by the routes and the service layer.
// All failures are 400s with a stable error code, so the portal gets a clear
// message instead of a 500 from the database.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

function badRequest(message, code = "INVALID_PARAMETER") {
  const err = new Error(message);
  err.status = 400;
  err.code = code;
  return err;
}

// connection_id is a uuid column, so reject malformed ids here, before the
// database does.
function requireConnectionId(value) {
  if (!value) throw badRequest("connectionId is required.", "MISSING_CONNECTION_ID");
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw badRequest("connectionId must be a valid UUID.");
  }
  return value;
}

// page starts at 1. pageSize defaults to DEFAULT_PAGE_SIZE and is capped at
// MAX_PAGE_SIZE. Anything that is not a whole positive number is a 400.
function parsePagination(query = {}) {
  const parse = (raw, fallback) => {
    if (raw === undefined) return fallback;
    return /^\d+$/.test(String(raw)) ? parseInt(raw, 10) : NaN;
  };
  const page = parse(query.page, 1);
  const pageSize = parse(query.pageSize, DEFAULT_PAGE_SIZE);

  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1) {
    throw badRequest("page and pageSize must be positive whole numbers.");
  }
  return { page, pageSize: Math.min(pageSize, MAX_PAGE_SIZE) };
}

module.exports = { requireConnectionId, parsePagination, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };
