// The Savings row is never a real `Category` record -- there's nothing to
// file a transaction against, so `income_by_category`/`spend_by_category`
// can never produce an "actual" for it the way every other category gets
// one. Its actual is derived instead, in Rust
// (`budget_calc::build_savings_line`): income minus every real expense
// category's actual, i.e. whatever's left over -- literally what got
// saved, not what someone remembered to log against a Savings bucket by
// hand.
//
// `SAVINGS_CATEGORY_ID` mirrors `commitments.js`'s `GOAL_PREFIX`/
// `DEBT_PREFIX` pattern: a synthetic id, JS-only, that `build_month` never
// sees and treats opaquely everywhere else -- used only as the
// `category_id` under which the Savings target amount is stored in
// `budgetPlan`. Must stay byte-identical to budget-calc's
// `category::SAVINGS_CATEGORY_ID`.
export const SAVINGS_CATEGORY_ID = '__savings__';

/**
 * Sum of `spent` across every real expense category's `build_month` line.
 * Income categories are excluded (their "spent" is money received, not
 * spent) and commitment (goal/debt) synthetic lines are excluded (nothing
 * is ever categorized against them, so their `spent` is always 0, but
 * excluding them keeps the intent explicit rather than relying on that).
 */
export function totalExpenseActual(lines, isIncome, isCommitment) {
  return lines
    .filter((l) => !isIncome(l.category_id) && !isCommitment(l.category_id))
    .reduce((sum, l) => sum + l.spent, 0);
}
