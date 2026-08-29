// Calendar arithmetic the host layer needs for display only -- which
// month is "now", how many days are left in it. Nothing here decides a
// budgeting rule; budget-calc's own functions take an explicit
// months-remaining count rather than reading a clock themselves (see
// crates/budget-calc/src/goals.rs).

export function currentMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Today as `YYYY-MM-DD`, in the reader's own timezone.
 *
 * Deliberately not `toISOString().slice(0, 10)`, which is UTC: east of
 * Greenwich that returns yesterday for the whole first part of the day.
 * A transaction stamped that way lands in the previous month whenever
 * someone logs spending in the small hours of the 1st -- and a spend that
 * silently misses the month it belongs to is exactly the quietly-wrong
 * number this app is not allowed to produce. Built from the same local
 * getters as `currentMonth`, so the two can never disagree about which
 * month "now" is in.
 */
export function todayIso(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function daysLeftInMonth(date = new Date()) {
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return end.getDate() - date.getDate();
}

export function monthsBetween(fromIso, toIso) {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  return Math.max(0, months);
}

export function monthLabel(monthStr, locale = 'en') {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, (m || 1) - 1, 1);
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'long' });
}

/** Day count for a `YYYY-MM` string -- the day-0-of-next-month trick. */
export function daysInMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m || 1, 0).getDate();
}

/** A `YYYY-MM` string shifted by `delta` whole months (negative goes
 *  back). Pure calendar arithmetic, same as `currentMonth` -- reads no
 *  data and decides no budgeting rule, just lets a screen page through
 *  months. */
export function shiftMonth(monthStr, delta) {
  const [y, m] = monthStr.split('-').map(Number);
  return currentMonth(new Date(y, (m || 1) - 1 + delta, 1));
}
