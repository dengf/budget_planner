// Which "mode" the Budget tab renders in for a given month -- a pure
// classification of numbers budget_calc already computed
// (summarize_month's `unassigned`), never a new calculation. See the
// design spec's Part 2: the same page should feel different while
// there's still an assignment decision to make versus once a month is
// fully planned and day-to-day tracking is what's left.
export const ASSIGN = 'assign';
export const TRACKING = 'tracking';

/**
 * `isPastMonth`: true once the viewed month has ended -- a past month's
 * assignment decision is moot, so it always renders as tracking
 * regardless of whether it ever reached fully-assigned.
 * `hasIncome`: whether any income category has a planned amount yet.
 * `unassigned`: `summary.unassigned` -- income minus total planned. Both
 * positive (still to assign) and negative (over-assigned) count as "not
 * done yet," since an over-assigned month still has a decision to make,
 * just the opposite one.
 */
export function budgetMode({ isPastMonth, hasIncome, unassigned }) {
  if (isPastMonth) return TRACKING;
  if (!hasIncome || unassigned !== 0) return ASSIGN;
  return TRACKING;
}
