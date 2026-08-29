// Whether the budget counts goal contributions and debt minimums as
// claims on this month's income.
//
// Off by default, deliberately. With it off, Goals and Debt payoff are
// what they have always been -- separate plans you look at on their own
// tabs -- and nobody's budget changes under them because a feature
// shipped. Turning it on is a statement that the same dollar shouldn't be
// counted twice.
//
// A stored preference, so host-layer, exactly like currencySymbol.js and
// income.js. What each commitment is *worth* per month is still Rust's
// answer (`required_contribution` for a goal, the debt's own minimum);
// this only records whether to ask.

const STORAGE_KEY = 'bp:commitments';

export function loadIncludeCommitments() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveIncludeCommitments(include) {
  try {
    localStorage.setItem(STORAGE_KEY, include ? '1' : '0');
  } catch {
    // Won't survive the tab; the toggle still works this session.
  }
}

/** Synthetic planned-entry ids, so a commitment line can be told apart
 *  from a real category line in `build_month`'s output without inventing
 *  a parallel code path through the Rust side. */
export const GOAL_PREFIX = 'goal:';
export const DEBT_PREFIX = 'debt:';
export const isCommitmentId = (id) => id.startsWith(GOAL_PREFIX) || id.startsWith(DEBT_PREFIX);
