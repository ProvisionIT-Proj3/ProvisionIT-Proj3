
const GROUPS = {
  asset: { code: '1-0000', name: 'Assets', type: 'Asset', normalSide: 'Dr' },
  liability: { code: '2-0000', name: 'Liabilities', type: 'Liability', normalSide: 'Cr' },
  equity: { code: '3-0000', name: 'Equity', type: 'Equity', normalSide: 'Cr' },
  income: { code: '4-0000', name: 'Income', type: 'Income', normalSide: 'Cr' },
  costOfSales: { code: '5-0000', name: 'Cost of Sales', type: 'Cost of Sales', normalSide: 'Dr' },
  expense: { code: '6-0000', name: 'Expenses', type: 'Expense', normalSide: 'Dr' },
  otherIncome: { code: '8-0000', name: 'Other Income', type: 'Other Income', normalSide: 'Cr' },
  otherExpense: { code: '9-0000', name: 'Other Expenses', type: 'Other Expense', normalSide: 'Dr' },
};

// Level-2 headers inside a group. A subgroup takes its parent's type and side.
const SUBGROUPS = {
  currentAsset: { parent: 'asset', code: '1-1000', name: 'Current Assets' },
  fixedAsset: { parent: 'asset', code: '1-4000', name: 'Fixed Assets' },
  currentLiability: { parent: 'liability', code: '2-1000', name: 'Current Liabilities' },
  nonCurrentLiability: { parent: 'liability', code: '2-5000', name: 'Non-Current Liabilities' },
};

// Accounts the vendor mapper can't classify (no Accounts list match, or a type
// this table doesn't know) are kept under a header of their own, never dropped.
const UNCLASSIFIED = { code: 'UNCLASSIFIED', name: 'Unclassified', type: 'Unclassified', normalSide: undefined };
const UNCLASSIFIED_KEY = 'unclassified';

// Report order of the groups.
const GROUP_ORDER = [...Object.keys(GROUPS), UNCLASSIFIED_KEY];

function groupDefinition(key) {
  return key === UNCLASSIFIED_KEY ? UNCLASSIFIED : GROUPS[key];
}

function subgroupsOf(groupKey) {
  return Object.entries(SUBGROUPS)
    .filter(([, sub]) => sub.parent === groupKey)
    .map(([key, sub]) => ({ key, ...sub, type: GROUPS[groupKey].type, normalSide: GROUPS[groupKey].normalSide }));
}

/**
 * Resolve a vendor classification, [groupKey, subgroupKey?], to keys that
 * exist here. An unknown group (or none) becomes unclassified; an unknown
 * subgroup is dropped, leaving the account directly under its group.
 */
function resolveClassification(classification) {
  const [groupKey, subgroupKey] = classification || [];
  if (!GROUPS[groupKey]) return { groupKey: UNCLASSIFIED_KEY, subgroupKey: undefined };

  const validSubgroup = SUBGROUPS[subgroupKey]?.parent === groupKey ? subgroupKey : undefined;
  return { groupKey, subgroupKey: validSubgroup };
}

module.exports = { GROUPS, SUBGROUPS, UNCLASSIFIED_KEY, GROUP_ORDER, groupDefinition, subgroupsOf, resolveClassification };
