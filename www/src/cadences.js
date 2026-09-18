/**
 * The cadences a schedule can repeat on, in the order they are offered.
 *
 * These are `budget_core::Cadence`'s variants, and every figure derived
 * from one -- a goal's required contribution, a recurring expense's
 * occurrences in a month -- is computed in Rust from this same string.
 * Nothing here decides what a cadence *means*; this is the list of what
 * can be picked, and the order it reads in.
 *
 * One list rather than the two that had grown (`GoalRows` and
 * `AddTransactionSheet` each held their own copy): a cadence added to
 * `Cadence` and to only one of them is a select that silently offers
 * less than the core supports.
 */
export const CADENCES = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];

export default CADENCES;
