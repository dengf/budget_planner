import React, { useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { EXPORT_FORMAT } from '../backup';
import { loadLastExported, saveLastExported } from '../lastExported';

// Chrome/Edge/Android can save/open straight through a native picker,
// which is what lets someone point an export at a folder their OS already
// syncs (iCloud Drive, Dropbox) instead of always landing in Downloads.
// Safari and Firefox -- all of iOS -- have neither method, so they keep
// today's <a download>/<input type=file> flow untouched, forever, unless
// those browsers ship the API. A function, not a module-level constant,
// so it reflects `window` at the moment it's checked rather than whatever
// it was the first time this module happened to load.
function hasFilePicker() {
  return (
    typeof window !== 'undefined' &&
    typeof window.showSaveFilePicker === 'function' &&
    typeof window.showOpenFilePicker === 'function'
  );
}

// Matches month.js's weekLabel style (short month, numeric day) plus a year,
// since this is the only place in the app showing a full past date rather
// than a month or a week range.
function formatExportDate(iso, locale) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

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
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [lastExported, setLastExported] = useState(loadLastExported);
  const fileInputRef = useRef(null);

  const markExported = () => {
    const iso = new Date().toISOString();
    saveLastExported(iso);
    setLastExported(iso);
  };

  // Returns whether the export actually went somewhere -- a cancelled
  // picker or a write failure both leave `false`, which is what tells the
  // Export button's own handler not to close the dialog on top of nothing
  // having happened.
  const exportData = async () => {
    // Always the app's real current month (`today`), not whatever month is
    // being browsed -- budget-plan rows are fetched per month, and this
    // app has no "every month" listing to export. `budgetPlan.items`
    // tracks `viewMonth` (App.jsx), so when someone exports while browsing
    // a different month, this fetches `today`'s plan on demand instead of
    // trusting `budgetPlan.items`.
    const todaysPlan =
      viewMonth === today
        ? budgetPlan.items
        : ((await wasmModule?.list_budget_plan?.(today)) ?? []);
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
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });

    if (hasFilePicker()) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: `budget-planner-${today}.json`,
          types: [
            {
              description: 'Budget Planner backup',
              accept: { 'application/json': ['.json'] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } catch (err) {
        if (err?.name !== 'AbortError') setImportResult({ error: t('data.exportFailed') });
        return false; // cancelled or failed either way -- nothing to mark
      }
      markExported();
      return true;
    }

    // No picker support (all of iOS Safari, Firefox): the plain
    // `<a download>` click below has no completion signal to wait for,
    // same as it never has -- marked exported on click, not on some later
    // confirmation that doesn't exist.
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `budget-planner-${today}.json`;
    a.click();
    URL.revokeObjectURL(url);
    markExported();
    return true;
  };

  const importFromFile = async (file) => {
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      setImportResult({ error: t('err.badImportFile') });
      return;
    }
    const outcome = await importData(payload);
    // A successful replace closes the dialog, same as Export/Clear -- an
    // error stays open so the message is readable, and a cancel
    // (outcome === null) leaves the dialog exactly as the person left it.
    if (outcome?.imported != null) {
      setOpen(false);
      return;
    }
    setImportResult(outcome);
  };

  const onImportFile = (e) => {
    const file = e.target.files?.[0];
    // Reset immediately so picking the same file twice still fires a change.
    e.target.value = '';
    if (!file) return;
    importFromFile(file);
  };

  const pickImportFile = async () => {
    if (!hasFilePicker()) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [
          {
            description: 'Budget Planner backup',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });
      await importFromFile(await handle.getFile());
    } catch (err) {
      if (err?.name !== 'AbortError') setImportResult({ error: t('err.importFailed') });
    }
  };

  const openMenu = () => {
    setImportResult(null);
    setOpen(true);
  };

  return (
    <div className="data-menu">
      <button
        type="button"
        className="app-data-trigger data-menu-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={openMenu}
      >
        {t('data.title')}
        <svg
          className="data-menu-caret"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden="true"
        >
          <path
            d="M1.5 3.5L5 7L8.5 3.5"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Deliberately NOT inside .data-menu-dialog (position: fixed) --
          iOS Safari/Chrome (both WebKit) can silently fail to open the
          native file picker for an <input type="file"> nested inside a
          fixed-position ancestor. Living here, in normal flow, and
          triggered via ref from a plain button in the dialog sidesteps
          that; the trigger button still calls .click() synchronously
          inside its own tap handler, which is what mobile Safari
          requires to treat the picker-open as user-initiated. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={onImportFile}
        style={{ display: 'none' }}
      />

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
              <button
                type="button"
                className="dash-month-btn"
                aria-label={t('monthpicker.close')}
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            <p className="panel-subtitle">{t('data.exportHint')}</p>
            <p className="panel-subtitle">
              {lastExported
                ? t('data.lastExported', {
                    date: formatExportDate(lastExported, locale),
                  })
                : t('data.neverExported')}
            </p>
            {hasFilePicker() && <p className="panel-subtitle">{t('data.syncTip')}</p>}

            <div className="data-menu-actions">
              <button
                type="button"
                className="btn secondary"
                onClick={async () => {
                  const ok = await exportData();
                  if (ok) setOpen(false);
                }}
              >
                {t('data.export')}
              </button>
              <button type="button" className="btn secondary" onClick={pickImportFile}>
                {t('data.import')}
              </button>
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

            {importResult?.error && (
              <p className="import-error" role="alert">
                {importResult.error}
              </p>
            )}
            {importResult?.imported != null && (
              <p className="headline">{t('data.imported', { count: importResult.imported })}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
