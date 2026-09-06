/**
 * Small normalization helpers shared across vendor mappers, so date/number
 * handling is consistent regardless of source platform quirks.
 */

/** Round to 2 decimal places and return a Number (avoids float string drift). */
function toMoney(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (Number.isNaN(n)) return undefined;
  return Math.round(n * 100) / 100;
}

/** Normalize a date-ish input (ISO string, epoch ms, or /Date(...)/ style) to 'YYYY-MM-DD'. */
function toISODate(value) {
  if (!value) return undefined;


  const msDateMatch = typeof value === 'string' && value.match(/\/Date\((\d+)([+-]\d+)?\)\//);
  if (msDateMatch) {
    return new Date(Number(msDateMatch[1])).toISOString().slice(0, 10);
  }

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

/** Normalize any timestamp-ish input to a UTC ISO 8601 string. */
function toUtcTimestamp(value) {
  if (!value) return undefined;

  const msDateMatch = typeof value === 'string' && value.match(/\/Date\((\d+)([+-]\d+)?\)\//);
  if (msDateMatch) {
    return new Date(Number(msDateMatch[1])).toISOString();
  }

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/** First non-empty value among the given candidates. */
function firstDefined(...candidates) {
  return candidates.find((v) => v !== undefined && v !== null && v !== '');
}

module.exports = { toMoney, toISODate, toUtcTimestamp, firstDefined };
