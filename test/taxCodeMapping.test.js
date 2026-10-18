const test = require("node:test");
const assert = require("node:assert/strict");

const { mapXeroTaxCode, XERO_TAX_TYPE_TO_CLIENT_CODE } = require("../src/mappers/xero/accountMapper");
const { mapQuickbooksTaxCode, QBO_TAX_CODE_NAME_TO_CLIENT_CODE } = require("../src/mappers/quickbooks/accountMapper");

// The client's codes, written out independently of the mapper tables so a
// change to a table entry has to be made here too.
const XERO_EXPECTED = {
  NONE: "N-T",
  BASEXCLUDED: "N-T",
  OUTPUT: "GST",
  OUTPUT2: "GST",
  INPUT: "GST",
  INPUT2: "GST",
  EXEMPTOUTPUT: "FRE",
  EXEMPTINPUT: "FRE",
  EXEMPTEXPORT: "FRE",
  EXEMPTCAPITAL: "FRE",
  EXEMPTEXPENSES: "FRE",
  GSTONCAPIMPORTS: "GCA",
  CAPEXINPUT: "GCA",
  CAPEXOUTPUT: "GCA",
};

// [QuickBooks AU TaxCode Name as the API sends it, client code]
const QBO_EXPECTED = [
  ["GST", "GST"],
  ["GST on non-capital", "GST"],
  ["GST on purchases", "GST"],
  ["GST on capital", "GCA"],
  ["GST free", "FRE"],
  ["GST-free export", "FRE"],
  ["GST free capital", "FRE"],
  ["GST-free non-capital", "FRE"],
  ["GST free purchases", "FRE"],
  ["Out of Scope", "N-T"],
];

test("every Xero tax type maps to the expected client code", () => {
  for (const [type, code] of Object.entries(XERO_EXPECTED)) assert.equal(mapXeroTaxCode(type), code, type);
});

test("the Xero table holds exactly the expected tax types, so a new one is a conscious decision", () => {
  assert.deepEqual(XERO_TAX_TYPE_TO_CLIENT_CODE, XERO_EXPECTED);
});

test("every QuickBooks AU tax code name maps to the expected client code", () => {
  for (const [name, code] of QBO_EXPECTED) {
    assert.equal(mapQuickbooksTaxCode({ value: "7" }, new Map([["7", name]])), code, name);
  }
});

test("the QuickBooks table holds exactly the expected names", () => {
  assert.equal(Object.keys(QBO_TAX_CODE_NAME_TO_CLIENT_CODE).length, QBO_EXPECTED.length);
});

test("QuickBooks tax code names match regardless of case, hyphens and spacing", () => {
  const variants = ["GST FREE EXPORT", "gst free export", "GST-free export", "  GST  free   export "];
  for (const name of variants) {
    assert.equal(mapQuickbooksTaxCode({ value: "7" }, new Map([["7", name]])), "FRE", JSON.stringify(name));
  }
});

test("QuickBooks tax code ids match whether the TaxCode query gave them as numbers or strings", () => {
  // buildQuickbooksAccounts stringifies TaxCode ids; the lookup stringifies the ref.
  assert.equal(mapQuickbooksTaxCode({ value: 7 }, new Map([["7", "GST"]])), "GST");
});

test("an unknown or absent tax code is never silently mapped", () => {
  assert.equal(mapXeroTaxCode("SOMETHINGNEW"), "UNMAPPED:SOMETHINGNEW");
  assert.equal(mapQuickbooksTaxCode({ value: "7" }, new Map([["7", "Something new"]])), "UNMAPPED:Something new");
  assert.equal(mapQuickbooksTaxCode({ value: "" }), undefined);
  assert.equal(mapQuickbooksTaxCode({ value: null }), undefined);
});

// Where Xero and QuickBooks describe the same AU tax treatment, the client must get the same code.
test("equivalent Xero and QuickBooks tax treatments give the same client code", () => {
  const pairs = [
    ["OUTPUT", "GST"],
    ["INPUT", "GST on purchases"],
    ["EXEMPTOUTPUT", "GST free"],
    ["EXEMPTEXPORT", "GST free export"],
    ["EXEMPTCAPITAL", "GST free capital"],
    ["EXEMPTEXPENSES", "GST free purchases"],
    ["EXEMPTEXPENSES", "GST-free non-capital"],
    ["CAPEXINPUT", "GST on capital"],
    ["NONE", "Out of Scope"],
  ];
  for (const [xeroType, qboName] of pairs) {
    const qbo = mapQuickbooksTaxCode({ value: "7" }, new Map([["7", qboName]]));
    assert.equal(mapXeroTaxCode(xeroType), qbo, `${xeroType} vs "${qboName}"`);
  }
});

// Tax treatments with no client code on either side stay visibly UNMAPPED in
// both vendors until the client says which code they want.
test("input taxed and imports are UNMAPPED in both vendors, not silently mapped", () => {
  assert.equal(mapXeroTaxCode("INPUTTAXED"), "UNMAPPED:INPUTTAXED");
  assert.equal(mapXeroTaxCode("GSTONIMPORTS"), "UNMAPPED:GSTONIMPORTS");
  assert.equal(mapQuickbooksTaxCode({ value: "7" }, new Map([["7", "Input tax"]])), "UNMAPPED:Input tax");
});
