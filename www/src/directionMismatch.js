// A signed amount and a category's own income/expense flag disagreeing is
// a real "quietly wrong number" case, not a UX nicety: `spend_by_category`
// only sums negative amounts and `income_by_category` only sums positive
// ones (see budget-calc/src/transaction.rs), so a positive amount typed
// against an expense category vanishes from both -- it fails the negative
// check for spend and the category-direction filter for income. This is
// the exact bug a live user hit: typed a plain positive number for an
// expense, category picked, and the amount disappeared from every report
// with no error anywhere.
//
// Host layer, not budget-calc, on purpose: this never touches Decimal
// precision or money arithmetic, only the sign of a value still being
// typed, and it has to be synchronous to give feedback as someone types --
// a wasm round trip per keystroke would be the wrong tool for a plain
// number-sign comparison.
export function directionMismatch(amount, categoryIsIncome) {
  if (amount === '' || amount === null || amount === undefined) return false;
  const n = Number(amount);
  if (Number.isNaN(n) || n === 0) return false;
  return n >= 0 !== categoryIsIncome;
}
