import React, { useState } from 'react';
import { useI18n } from '../i18n';
import { EXPORT_FORMAT } from '../backup';

/**
 * "Your data" as a nav-level dropdown rather than a tab -- it isn't a
 * page of its own (nothing here is browsed or edited in place), just
 * three one-shot actions (export/import/clear) that apply to the whole
 * app's data regardless of which tab happens to be open. Living in the
 * nav means it's reachable from anywhere without a tab switch losing
 * whatever the person was looking at.
 *
 * Moved here verbatim from DashboardTab, which is where these three
 * actions used to live (at the bottom of the Dashboard panel) -- same
 * exportData/onImportFile logic, same props, just no longer tied to one
 * tab's lifecycle.
 */
export default function YourDataMenu({
  wasmModule,
  today,
  viewMonth,
  categories,
  transactions,
  rules,
  budgetPlan,
  goals,
  debts,
  recurring,
  clearAllData,
  importData,
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [importResult, setImportResult] = useState(null);

  // Always the app's real current month (`today`), not whatever month is
  // being browsed -- budget-plan rows are fetched per month, and this
  // app has no "every month" listing to export. `budgetPlan.items`
  // tracks `viewMonth` (App.jsx), so when someone exports while browsing
  // a different month, this fetches `today`'s plan on demand instead of
  // trusting `budgetPlan.items`.
  const exportData = async () => {
    const todaysPlan =
      viewMonth === today ? budgetPlan.items : ((await wasmModule?.list_budget_plan?.(today)) ?? []);
    const payload = {
      format: EXPORT_FORMAT,
      exported_at: new Date().toISOString(),
      categories: categories.items,
      transactions: transactions.items,
      rules: rules.items,
      goals: goals.items,
      debts: debts.items,
      recurring: recurring.items,
      // No separate `income` field: income is the sum of whatever's
      // planned against the income categories already included above
      // (`categories` carries `is_income`, `budget_plan.entries` carries
      // each category's planned amount) -- restoring both is restoring
      // income, with nothing else to name explicitly.
      budget_plan: { month: today, entries: todaysPlan },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `budget-planner-${today}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportFile = (e) => {
    const file = e.target.files?.[0];
    // Reset immediately so picking the same file twice still fires a change.
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let payload;
      try {
        payload = JSON.parse(String(reader.result ?? ''));
      } catch {
        setImportResult({ error: t('err.badImportFile') });
        return;
      }
      const outcome = await importData(payload);
      setImportResult(outcome);
    };
    reader.readAsText(file);
  };

  const openMenu = () => {
    setImportResult(null);
    setOpen(true);
  };

  return (
    <div className="data-menu">
      <button
        type="button"
        className="app-tab"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={openMenu}
      >
        {t('data.title')}
      </button>

      {open && (
        <div className="data-menu-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="data-menu-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t('data.title')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="data-menu-header">
              <span className="data-menu-title">{t('data.title')}</span>
              <button type="button" className="dash-month-btn" aria-label={t('monthpicker.close')} onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
            <p className="panel-subtitle">{t('data.exportHint')}</p>

            <div className="data-menu-actions">
              <button
                type="button"
                className="btn secondary"
                onClick={async () => {
                  await exportData();
                  setOpen(false);
                }}
              >
                {t('data.export')}
              </button>
              <label className="btn secondary import-button">
                {t('data.import')}
                <input type="file" accept="application/json,.json" onChange={onImportFile} />
              </label>
              <button
                type="button"
                className="btn danger"
                onClick={async () => {
                  await clearAllData();
                  setOpen(false);
                }}
              >
                {t('data.clearAll')}
              </button>
            </div>

            {importResult?.error && <p className="import-error" role="alert">{importResult.error}</p>}
            {importResult?.imported != null && (
              <p className="headline">{t('data.imported', { count: importResult.imported })}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
