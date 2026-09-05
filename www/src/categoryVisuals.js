// Which color and icon a category gets in its `CategoryBadge`. Pure,
// host-layer, no React -- same "display preference, not a budget-calc
// concept" reasoning as currencySymbol.js: a category's color/icon is
// never matched on for behaviour anywhere in this app, only for display.
//
// A category created from a starter preset carries a stable `preset_key`
// (e.g. "cat.housing", set once at creation -- see App.jsx's
// `addCommonCategories`), which is what icon/color matching keys off.
// Matching on `name` instead would break the moment someone renames a
// category or the UI locale changes, since `name` is translated text
// frozen at creation time, not a stable identifier.

// The same 10 colors PieChart.jsx used to keep locally, moved here so the
// donut and every badge/list row draw from one source of truth instead of
// two copies drifting apart -- and so both now pick a color by category
// *identity* (see categoryColor below) rather than PieChart's old
// by-value-rank assignment, which could shift a category's color between
// renders whenever the ranking changed.
//
// Anchored on meifio's plum (see meifio-brand/README.md's colour table,
// #B01243 light / #F2547F dark) rather than an arbitrary hue -- each
// hand-tuned in lightness so every entry lands close to a ~4.2:1 contrast
// ratio against both this app's dark background (#0f1720) and
// print/light-mode white. `--accent` (main.css) is this same plum family
// too now, so the app's chrome and its category colors finally agree --
// they used to deliberately differ, back when this app still kept
// mortgage_calculator's inherited blue/green for its chrome.
//
// Ordering: adjacent entries jump by half the wheel (0, 180, 36, 216,
// 72deg...) rather than stepping straight around it, so two consecutive
// palette entries always land at least 144deg apart -- the same reasoning
// PieChart used when index order followed value rank. Now that index
// order instead follows PRESET_KEY_ORDER below, this spreads adjacently
// *declared* presets apart rather than adjacently *ranked* ones -- a
// smaller win than the original per-household optimum, but the one this
// module can still promise regardless of which categories a given budget
// actually uses.
export const CATEGORY_PALETTE = [
  '#E52E5F',
  '#118D6C',
  '#CC5519',
  '#1681B6',
  '#888011',
  '#656EEC',
  '#498811',
  '#A353EA',
  '#118D22',
  '#DA1BC0',
];

// Fixed declaration order of the 16 starter presets (matches
// `crates/budget-calc/src/presets.rs`'s INCOME_CATEGORIES then
// EXPENSE_CATEGORIES) -- a preset's position here is its permanent color
// index, so "Housing" is always the same color, not just stable within
// one render.
const PRESET_KEY_ORDER = [
  'cat.primaryEarnedIncome',
  'cat.selfEmploymentBusiness',
  'cat.investmentCapitalIncome',
  'cat.governmentSupplemental',
  'cat.otherIncome',
  'cat.housing',
  'cat.utilities',
  'cat.foodGroceries',
  'cat.transportation',
  'cat.healthcareInsurance',
  'cat.debtServicing',
  'cat.personalLifestyle',
  'cat.familyDependents',
  'cat.otherExpenses',
  'cat.subscriptionsMemberships',
  'cat.giftsDonations',
];

const PRESET_ICONS = {
  'cat.primaryEarnedIncome': 'paycheck',
  'cat.selfEmploymentBusiness': 'briefcase',
  'cat.investmentCapitalIncome': 'trending-up',
  'cat.governmentSupplemental': 'building',
  'cat.otherIncome': 'coin',
  'cat.housing': 'house',
  'cat.utilities': 'bolt',
  'cat.foodGroceries': 'basket',
  'cat.transportation': 'car',
  'cat.healthcareInsurance': 'heart',
  'cat.debtServicing': 'card',
  'cat.personalLifestyle': 'sparkle',
  'cat.familyDependents': 'people',
  'cat.otherExpenses': 'tag',
  'cat.subscriptionsMemberships': 'repeat',
  'cat.giftsDonations': 'gift',
};

/** Which icon id (a key into CategoryIcons.jsx's lookup map) a category's badge shows. */
export function categoryIconId(category) {
  return (
    PRESET_ICONS[category?.preset_key] ??
    (category?.is_income ? 'income-generic' : 'expense-generic')
  );
}

// A short, deterministic hash so a hand-typed category (no preset_key)
// still gets a fixed, non-gray color instead of always the same default
// -- djb2, chosen only because it's a few lines and good enough for
// spreading a handful of ids across 10 buckets, not for anything
// security-sensitive.
function hashString(value) {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return Math.abs(hash);
}

/** Which color from CATEGORY_PALETTE a category's badge (and its pie wedge) uses. */
export function categoryColor(category) {
  const presetIndex = PRESET_KEY_ORDER.indexOf(category?.preset_key);
  const index = presetIndex >= 0 ? presetIndex : hashString(category?.id ?? '');
  return CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];
}
