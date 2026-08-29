// This month's income is a number the person types, not something any
// calculation here derives -- so it lives beside `currencySymbol` as a
// stored preference (localStorage), keyed per month, rather than as a
// budget-calc concept. See currencySymbol.js for the same pattern.

function key(month) {
  return `bp:income:${month}`;
}

export function loadIncome(month) {
  try {
    const raw = localStorage.getItem(key(month));
    const n = raw == null ? 0 : Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function saveIncome(month, amount) {
  try {
    localStorage.setItem(key(month), String(amount));
  } catch {
    // Not persisted this session; the field still works in memory.
  }
}
