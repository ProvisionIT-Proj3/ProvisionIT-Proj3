/**
 * Transform a raw Xero data export (contacts.json, invoices.json,
 * payments.json) into canonical form and write the result to a single
 * JSON file — no demo prose, no test assertions, just the transformation.
 *
 * Usage:
 *   node transform.js [inputDir] [outputFile]
 *
 * Defaults:
 *   inputDir   = ./sample_data/xero
 *   outputFile = ./output/canonical-output.json
 *
 */
const fs = require('fs');
const path = require('path');
const { mapToCanonical } = require('./src/index');

const inputDir = process.argv[2] || path.join(__dirname, 'sample-data', 'xero');
const outputFile = process.argv[3] || path.join(__dirname, 'output', 'canonical-output.json');

function loadJsonArray(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Array.isArray(parsed) ? parsed : [];
}

function rawId(raw) {
  return raw.ContactID || raw.InvoiceID || raw.PaymentID || null;
}

/** Map every record in rawRecords, splitting the results into mapped / filtered-out / invalid. */
function transformAll(vendor, entityType, rawRecords) {
  const mapped = [];
  const filteredOutIds = [];
  const invalid = [];

  for (const raw of rawRecords) {
    const { canonical, validation } = mapToCanonical(vendor, entityType, raw);

    if (canonical === null) {
      filteredOutIds.push(rawId(raw));
      continue;
    }
    if (validation && !validation.valid) {
      invalid.push({ id: canonical.id, errors: validation.errors });
    }
    mapped.push(canonical);
  }

  return { mapped, filteredOutIds, invalid };
}

const contacts = loadJsonArray(path.join(inputDir, 'contacts.json'));
const invoices = loadJsonArray(path.join(inputDir, 'invoices.json'));
const payments = loadJsonArray(path.join(inputDir, 'payments.json'));

const customers = transformAll('xero', 'customer', contacts);
const invoicesResult = transformAll('xero', 'invoice', invoices);
const paymentsResult = transformAll('xero', 'payment', payments);

const output = {
  generatedAt: new Date().toISOString(),
  source: { vendor: 'xero', inputDir },
  customers: customers.mapped,
  invoices: invoicesResult.mapped,
  payments: paymentsResult.mapped,
  summary: {
    customers: {
      total: contacts.length,
      mapped: customers.mapped.length,
      filteredOut: customers.filteredOutIds.length,
      invalid: customers.invalid.length,
    },
    invoices: {
      total: invoices.length,
      mapped: invoicesResult.mapped.length,
      filteredOut: invoicesResult.filteredOutIds.length,
      invalid: invoicesResult.invalid.length,
    },
    payments: {
      total: payments.length,
      mapped: paymentsResult.mapped.length,
      filteredOut: paymentsResult.filteredOutIds.length,
      invalid: paymentsResult.invalid.length,
    },
  },
};

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));

console.log(`Wrote canonical output to ${outputFile}`);
console.log(JSON.stringify(output.summary, null, 2));
