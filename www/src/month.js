// Calendar arithmetic the host layer needs for display only -- which
// month is "now", how many days are left in it. Nothing here decides a
// budgeting rule; budget-calc's own functions take an explicit
// months-remaining count rather than reading a clock themselves (see
// crates/budget-calc/src/goals.rs).

export function currentMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
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
