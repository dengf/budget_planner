// The shape of the file "Export all data" writes and "Import" reads.
//
// Host-layer by the same reasoning as currencySymbol.js: this is our own file
// envelope, not a domain decision. The records inside were validated by
// budget-calc on the way in and are round-tripped by the store unchanged,
// so nothing here re-derives a figure. Contrast CSV import, which decides
// an amount and a category from someone else's file and therefore lives
// in Rust (`budget-calc::csv_import`).
//
// What this module does own is refusing to touch anything until the file
// looks like ours -- an import that half-applies a wrong file, having
// already wiped what was there, is unrecoverable for a person whose only
// copy was the thing they just deleted.

export const EXPORT_FORMAT = 'meifio.budget_planner.v1';

/** The seven persisted collections, in dependency order: categories exist
 *  before the transactions, recurring expenses and plan rows that
 *  reference them. */
export const COLLECTIONS = ['categories', 'rules', 'transactions', 'goals', 'debts', 'recurring'];

function isRecordArray(value) {
  return Array.isArray(value) && value.every((r) => r && typeof r === 'object' && typeof r.id === 'string');
}

/**
 * Validates a parsed export file.
 *
 * Returns `{ ok: true, ... }` with everything an import needs, or
 * `{ ok: false, reason }` where `reason` is an i18n key. Deliberately
 * strict: a file we only half-recognize is rejected rather than merged,
 * because the import replaces existing data.
 */
export function readBackup(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'err.badImportFile' };
  if (payload.format !== EXPORT_FORMAT) return { ok: false, reason: 'err.badImportFile' };

  for (const name of COLLECTIONS) {
    // A missing collection is fine (an older file, or one exported before
    // a feature existed); a present-but-malformed one is not.
    if (payload[name] !== undefined && !isRecordArray(payload[name])) {
      return { ok: false, reason: 'err.badImportFile' };
    }
  }

  const plan = payload.budget_plan;
  if (plan !== undefined) {
    if (!plan || typeof plan !== 'object' || !isRecordArray(plan.entries ?? [])) {
      return { ok: false, reason: 'err.badImportFile' };
    }
  }

  return {
    ok: true,
    collections: Object.fromEntries(COLLECTIONS.map((name) => [name, payload[name] ?? []])),
    budgetPlan: { month: plan?.month ?? null, entries: plan?.entries ?? [] },
    // A pre-derived-income export's `payload.income` field, if present, is
    // simply ignored -- income is recomputed from `categories` (is_income)
    // and `budgetPlan.entries` (planned amounts), both restored above, not
    // read out of the file as its own figure any more.
    count:
      COLLECTIONS.reduce((n, name) => n + (payload[name]?.length ?? 0), 0) +
      (plan?.entries?.length ?? 0),
  };
}
