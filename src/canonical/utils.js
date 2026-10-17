/** Normalization helpers shared by the vendor mappers. */

/** Round to 2 decimal places as a Number; undefined for empty or non-numeric input. */
function toMoney(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (Number.isNaN(n)) return undefined;
  return Math.round(n * 100) / 100;
}

/** Normalize a timestamp to UTC ISO 8601; undefined if it can't be parsed. */
function toUtcTimestamp(value) {
  if (!value) return undefined;

  // Xero's legacy "/Date(ms+offset)/" format isn't understood by Date().
  const msDateMatch = typeof value === 'string' && value.match(/\/Date\((\d+)([+-]\d+)?\)\//);
  if (msDateMatch) {
    return new Date(Number(msDateMatch[1])).toISOString();
  }

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

module.exports = { toMoney, toUtcTimestamp };
