const test = require("node:test");
const assert = require("node:assert/strict");

const quickbooks = require("../src/mappers/quickbooks/accountMapper");
const xero = require("../src/mappers/xero/accountMapper");
const { validate } = require("../src/canonical/schemas");

// Property tests: hundreds of random reports per vendor, each checked against
// an answer computed independently from the generated numbers. The generator
// is seeded, so a failure reproduces; the seed and case number are in the
// assertion message.
const SEED = 20261015;
const CASES = 300;

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rand, list) => list[Math.floor(rand() * list.length)];

// Amount strings as vendors send them (and as the parser has to tolerate),
// paired with the number each one means.
const AMOUNTS = [
  ["", 0],
  ["0.00", 0],
  ["0", 0],
  ["12.34", 12.34],
  ["100.00", 100],
  ["1,234.50", 1234.5],
  ["-50.00", -50],
  ["(75.25)", -75.25],
  ["0.10", 0.1],
  ["0.20", 0.2],
  ["999999.99", 999999.99],
];

const CLASSES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];
const SECTION_TITLES = ["Assets", "Liabilities", "Equity", "Revenue", "Expenses"];
const round2 = (n) => Math.round(n * 100) / 100;

// One random set of accounts: the report rows plus the expected canonical answer.
function generateAccounts(rand) {
  const count = Math.floor(rand() * 15); // 0..14, so empty sections are covered
  return Array.from({ length: count }, (_, i) => {
    const [debitText, debit] = pick(rand, AMOUNTS);
    const [creditText, credit] = pick(rand, AMOUNTS);
    return {
      id: `id-${i}`,
      name: pick(rand, ["Bank", "Sales", "Rent", "Loan", "Bank"]), // names repeat on purpose
      class: pick(rand, CLASSES),
      debitText,
      creditText,
      debit,
      credit,
    };
  });
}

// Expected side and value for one account, worked out from the numbers alone.
function expected(account, fallback) {
  const net = round2(account.debit - account.credit);
  return { drCr: net > 0 ? "Dr" : net < 0 ? "Cr" : fallback, value: Math.abs(net) };
}

const QBO_CLASSIFICATION = { ASSET: "Asset", LIABILITY: "Liability", EQUITY: "Equity", REVENUE: "Revenue", EXPENSE: "Expense" };
const QBO_FALLBACK = { Asset: "Dr", Expense: "Dr", Liability: "Cr", Equity: "Cr", Revenue: "Cr" };
const XERO_FALLBACK = { ASSET: "Dr", EXPENSE: "Dr", LIABILITY: "Cr", EQUITY: "Cr", REVENUE: "Cr" };

// --- report builders ---------------------------------------------------------

function qboReport(rand, accounts) {
  const data = (a) => ({ type: "Data", ColData: [{ value: a.name, id: a.id }, { value: a.debitText }, { value: a.creditText }] });
  const grandTotal = { type: "Section", group: "GrandTotal", Summary: { ColData: [{ value: "TOTAL" }, { value: "0.00" }, { value: "0.00" }] } };

  if (rand() < 0.5) {
    return { Rows: { Row: [...accounts.map(data), grandTotal] } }; // flat, as QuickBooks really sends it
  }
  const rows = SECTION_TITLES.map((title, i) => ({
    type: "Section",
    Header: { ColData: [{ value: title }, { value: "" }, { value: "" }] },
    Rows: { Row: accounts.filter((a) => a.class === CLASSES[i]).map(data) },
  }));
  return { Rows: { Row: [...rows, grandTotal] } };
}

function xeroReport(accounts) {
  const cell = (value, id) => ({ Value: value, Attributes: id ? [{ Id: "account", Value: id }] : undefined });
  const row = (a) => ({
    RowType: "Row",
    // Debit/Credit hold the month's movement; the balance is in the YTD pair, so make them differ.
    Cells: [cell(a.name, a.id), cell("999.99"), cell("888.88"), cell(a.debitText), cell(a.creditText)],
  });
  return {
    Reports: [
      {
        Rows: [
          { RowType: "Header", Cells: ["Account", "Debit", "Credit", "YTD Debit", "YTD Credit"].map((Value) => ({ Value })) },
          ...SECTION_TITLES.map((Title, i) => ({
            RowType: "Section",
            Title,
            Rows: accounts.filter((a) => a.class === CLASSES[i]).map(row),
          })),
          { RowType: "Section", Title: "", Rows: [{ RowType: "SummaryRow", Cells: [cell("Total"), cell("1.00"), cell("1.00"), cell("1.00"), cell("1.00")] }] },
        ],
      },
    ],
  };
}

// --- the properties ----------------------------------------------------------

function checkProperties({ vendor, accounts, output, fallback, label }) {
  const fail = (msg) => `${label}: ${msg}`;

  const ids = output.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, fail("ids must be unique (the table is unique on connection + id)"));

  for (const row of output) {
    const { valid, errors } = validate("account", row);
    assert.ok(valid, fail(`row ${row.id} fails the canonical schema: ${errors.join("; ")}`));
    assert.equal(row.sourceSystem, vendor, fail("sourceSystem"));
    assert.ok([undefined, "Dr", "Cr"].includes(row.drCr), fail(`drCr was ${row.drCr}`));
    assert.ok(Number.isFinite(row.value) && row.value >= 0, fail(`value ${row.value} must be a finite, non-negative number`));
    assert.equal(round2(row.value), row.value, fail(`value ${row.value} must be rounded to cents`));
    assert.equal(row.level, row.isHeader ? 1 : 2, fail("level matches header/detail"));
  }

  // Report order: every detail row sits under a header, and headers are numbered in order.
  assert.ok(output.length === 0 || output[0].isHeader, fail("the first row must be a header"));
  const headers = output.filter((r) => r.isHeader);
  assert.deepEqual(headers.map((h) => h.code), headers.map((_, i) => `HDR-${i + 1}`), fail("header codes"));

  // Oracle: every generated account with an id comes out once, with the side and value worked out independently.
  const details = new Map(output.filter((r) => !r.isHeader).map((r) => [r.id, r]));
  assert.equal(details.size, accounts.length, fail("every account row is kept"));
  for (const a of accounts) {
    const want = expected(a, fallback(a));
    const got = details.get(a.id);
    assert.ok(got, fail(`account ${a.id} is missing`));
    assert.equal(got.value, want.value, fail(`account ${a.id} value for ${a.debitText}/${a.creditText}`));
    assert.equal(got.drCr, want.drCr, fail(`account ${a.id} side for ${a.debitText}/${a.creditText}`));
    assert.equal(got.name, a.name, fail(`account ${a.id} name`));
  }

  // Each generated report carries no Summary rows, so a header is its detail rows netted.
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const headerRows = output.map((r, i) => ({ r, i })).filter(({ r }) => r.isHeader);
  headerRows.forEach(({ r: header, i }, h) => {
    const end = h + 1 < headerRows.length ? headerRows[h + 1].i : output.length;
    const members = output.slice(i + 1, end).map((r) => byId.get(r.id));
    const net = round2(members.reduce((sum, a) => sum + a.debit, 0) - members.reduce((sum, a) => sum + a.credit, 0));
    assert.equal(header.value, Math.abs(net), fail(`header ${header.name} value`));
    assert.equal(header.drCr, net > 0 ? "Dr" : net < 0 ? "Cr" : undefined, fail(`header ${header.name} side`));
  });
}

test(`QuickBooks mapper properties over ${CASES} random reports (seed ${SEED})`, () => {
  const rand = prng(SEED);
  for (let n = 0; n < CASES; n++) {
    const accounts = generateAccounts(rand);
    const report = qboReport(rand, accounts);
    const output = quickbooks.buildQuickbooksAccounts([], report);
    // No Account query in this run, so there is no Classification: a zero balance has no side.
    checkProperties({ vendor: "quickbooks", accounts, output, fallback: () => undefined, label: `qbo case ${n}` });
  }
});

test(`QuickBooks mapper properties with the Account list joined in (seed ${SEED})`, () => {
  const rand = prng(SEED + 1);
  for (let n = 0; n < CASES; n++) {
    const accounts = generateAccounts(rand);
    const rawAccounts = accounts.map((a) => ({ Id: a.id, Name: a.name, Classification: QBO_CLASSIFICATION[a.class], AccountType: "Bank" }));
    const output = quickbooks.buildQuickbooksAccounts(rawAccounts, qboReport(rand, accounts));
    checkProperties({
      vendor: "quickbooks",
      accounts,
      output,
      fallback: (a) => QBO_FALLBACK[QBO_CLASSIFICATION[a.class]],
      label: `qbo+accounts case ${n}`,
    });
  }
});

test(`Xero mapper properties over ${CASES} random reports (seed ${SEED})`, () => {
  const rand = prng(SEED + 2);
  for (let n = 0; n < CASES; n++) {
    const accounts = generateAccounts(rand);
    const rawAccounts = accounts.map((a) => ({ AccountID: a.id, Code: a.id.replace("id-", ""), Name: a.name, Type: "BANK", Class: a.class }));
    const output = xero.buildXeroAccounts(rawAccounts, xeroReport(accounts));
    checkProperties({ vendor: "xero", accounts, output, fallback: (a) => XERO_FALLBACK[a.class], label: `xero case ${n}` });
  }
});

test("the title-less grand-total section never becomes a header, in either vendor", () => {
  const rand = prng(SEED + 3);
  for (let n = 0; n < 50; n++) {
    const accounts = generateAccounts(rand);
    const titles = [
      ...quickbooks.buildQuickbooksAccounts([], qboReport(rand, accounts)),
      ...xero.buildXeroAccounts([], xeroReport(accounts)),
    ]
      .filter((r) => r.isHeader)
      .map((h) => h.name);
    assert.ok(titles.every((t) => typeof t === "string" && t.length > 0), `case ${n}: ${JSON.stringify(titles)}`);
  }
});

test("hostile input never crashes the parsers with anything but the deliberate amount error", () => {
  const junk = [undefined, null, {}, { Rows: null }, { Rows: { Row: null } }, { Rows: { Row: [null] } }, { Reports: [] }, { Reports: [{}] }, { Reports: [{ Rows: [{}] }] }, { Reports: [{ Rows: [null] }] }, { Reports: [{ Rows: [null, { RowType: "Header", Cells: [] }] }] }];
  for (const input of junk) {
    for (const parse of [quickbooks.parseTrialBalanceReport, xero.parseTrialBalanceReport]) {
      let result;
      try {
        result = parse(input);
      } catch (error) {
        assert.match(error.message, /Unparseable/, `unexpected ${error.message} for ${JSON.stringify(input)}`);
        continue;
      }
      assert.ok(Array.isArray(result), `expected a list for ${JSON.stringify(input)}`);
    }
  }
});

// The generators above give every account a distinct id and section title, so
// they can't exercise id collisions. This one repeats section titles and
// leaves account ids off, which makes ids like "unmatched:<name>" collide.
test("ids stay unique and no row is lost when section titles and unmatched names repeat", () => {
  const rand = prng(SEED + 4);
  for (let n = 0; n < CASES; n++) {
    const sections = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => ({
      title: pick(rand, ["A", "B"]),
      names: Array.from({ length: Math.floor(rand() * 5) }, () => pick(rand, ["X", "Y"])),
    }));
    const detailCount = sections.reduce((sum, s) => sum + s.names.length, 0);

    const qbo = {
      Rows: {
        Row: sections.map((s) => ({
          type: "Section",
          Header: { ColData: [{ value: s.title }] },
          Rows: { Row: s.names.map((name) => ({ type: "Data", ColData: [{ value: name }, { value: "1.00" }, { value: "" }] })) },
        })),
      },
    };
    const xeroRep = {
      Reports: [
        {
          Rows: sections.map((s) => ({
            RowType: "Section",
            Title: s.title,
            Rows: s.names.map((name) => ({ RowType: "Row", Cells: [{ Value: name }, { Value: "1.00" }, { Value: "" }] })),
          })),
        },
      ],
    };

    for (const [vendor, output] of [
      ["quickbooks", quickbooks.buildQuickbooksAccounts([], qbo)],
      ["xero", xero.buildXeroAccounts([], xeroRep)],
    ]) {
      const ids = output.map((r) => r.id);
      assert.equal(new Set(ids).size, ids.length, `${vendor} case ${n}: duplicate ids in ${JSON.stringify(ids)}`);
      assert.equal(output.filter((r) => !r.isHeader).length, detailCount, `${vendor} case ${n}: a row was lost`);
      assert.equal(output.filter((r) => r.isHeader).length, sections.length, `${vendor} case ${n}: a header was lost`);
    }
  }
});
