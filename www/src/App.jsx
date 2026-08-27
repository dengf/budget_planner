import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Header from './components/Header';
import Intro from './components/Intro';
import { useConfirm } from './components/ConfirmDialog';
import { I18nProvider, detectLocale, useI18n } from './i18n';
import { detectRegion, rememberRegion } from './region';
import { hasSeeded, rememberSeeded } from './seeded';
import UpdateBanner from './components/UpdateBanner';
import { COLLECTIONS, readBackup } from './backup';
import { saveIncome } from './income';
import { currentMonth } from './month';

// Code-split: a visitor logging one transaction shouldn't download the
// debt-payoff engine's UI too. Each tab's component (and everything it
// imports) only loads the first time its tab is opened.
const BudgetTab = React.lazy(() => import('./components/BudgetTab'));
const TransactionsTab = React.lazy(() => import('./components/TransactionsTab'));
const GoalsTab = React.lazy(() => import('./components/GoalsTab'));
const DebtTab = React.lazy(() => import('./components/DebtTab'));
const ReportTab = React.lazy(() => import('./components/ReportTab'));

const TABS = {
  budget: BudgetTab,
  transactions: TransactionsTab,
  goals: GoalsTab,
  debt: DebtTab,
  report: ReportTab,
};

/**
 * Every collection this app persists, loaded once wasm storage is ready
 * and kept in memory from then on.
 *
 * `save`/`remove` patch `items` locally rather than re-fetching the whole
 * collection from IndexedDB after every write. The wasm call already
 * returns (or receives) the record in full, so there is nothing a re-list
 * would learn that a local upsert doesn't already know -- and a full
 * `list_*` round trip after every keystroke-adjacent save is the one thing
 * in this app whose cost scales with how much history exists, which is
 * exactly backwards for a tool whose whole pitch is "fast."
 */
function useCollection(wasmModule, listFn, saveFn, deleteFn, listArg) {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!wasmModule?.[listFn]) return;
    const result = await wasmModule[listFn](listArg);
    setItems(Array.isArray(result) ? result : []);
    setLoaded(true);
  }, [wasmModule, listArg]);

  useEffect(() => {
    reload();
  }, [reload]);

  const save = useCallback(
    async (record) => {
      if (!wasmModule?.[saveFn]) return { error: 'unavailable' };
      const result = await wasmModule[saveFn](record);
      if (!result?.error) {
        const id = result.id ?? record.id;
        const saved = { ...record, id };
        setItems((prev) => {
          const idx = prev.findIndex((it) => it.id === id);
          if (idx === -1) return [...prev, saved];
          const copy = prev.slice();
          copy[idx] = saved;
          return copy;
        });
      }
      return result;
    },
    [wasmModule, saveFn],
  );

  const remove = useCallback(
    async (id) => {
      if (!wasmModule?.[deleteFn]) return { success: false };
      const result = await wasmModule[deleteFn](id);
      if (result?.success !== false) {
        setItems((prev) => prev.filter((it) => it.id !== id));
      }
      return result ?? { success: true };
    },
    [wasmModule, deleteFn],
  );

  return { items, loaded, save, remove, reload };
}

function TabFallback() {
  const { t } = useI18n();
  return <p className="empty-state">{t('app.loading')}</p>;
}

export function AppShell({ wasmModule }) {
  const [activeTab, setActiveTab] = useState('budget');
  const [region, setRegion] = useState(() => detectRegion());
  const [month] = useState(() => currentMonth());
  const { t } = useI18n();
  const [confirm, confirmDialog] = useConfirm();
  const [guardResult, setGuardResult] = useState(null);

  const categories = useCollection(wasmModule, 'list_categories', 'save_category', 'delete_category');
  const transactions = useCollection(wasmModule, 'list_transactions', 'save_transaction', 'delete_transaction');
  const rules = useCollection(wasmModule, 'list_rules', 'save_rule', 'delete_rule');
  const goals = useCollection(wasmModule, 'list_goals', 'save_goal', 'delete_goal');
  const debts = useCollection(wasmModule, 'list_debts', 'save_debt', 'delete_debt');
  const recurring = useCollection(
    wasmModule,
    'list_recurring_expenses',
    'save_recurring_expense',
    'delete_recurring_expense',
  );
  const budgetPlan = useCollection(
    wasmModule,
    'list_budget_plan',
    'save_budget_plan_entry',
    'delete_budget_plan_entry',
    month,
  );

  const newId = useCallback(() => (wasmModule?.new_id ? wasmModule.new_id() : `local-${Date.now()}`), [wasmModule]);

  /**
   * A deleted category used to leave its raw id string on screen wherever
   * a transaction still pointed at it (BudgetTab and ReportTab's
   * `categoryName()` both fell back to the id itself). Blocking the
   * delete when a transaction references the category closes that off at
   * the source rather than patching every place a category name gets
   * displayed.
   *
   * A current-month budget-plan row referencing the category is cascaded
   * (deleted along with it) rather than blocking on it too: unlike a
   * transaction, a plan row is this app's own bookkeeping -- "this
   * month's planned amount for category X" -- fully regenerated the next
   * time someone types an amount, not user content that would be lost.
   *
   * A recurring expense pointed at the category is blocked on for the
   * same reason as a transaction: it is a standing bill someone set up on
   * purpose, and losing which category it belonged to is the same
   * dangling-reference bug, just for spending that hasn't happened yet.
   */
  const removeCategory = useCallback(
    async (id) => {
      const inUseTransactions = transactions.items.filter((t) => t.category_id === id);
      const inUseRecurring = recurring.items.filter((r) => r.category_id === id);
      const inUseCount = inUseTransactions.length + inUseRecurring.length;
      if (inUseCount > 0) {
        const category = categories.items.find((c) => c.id === id);
        setGuardResult({
          error: t('err.categoryInUse', { name: category?.name ?? id, count: inUseCount }),
        });
        return;
      }
      const ok = await confirm(t('confirm.removeCategory', { name: categories.items.find((c) => c.id === id)?.name ?? id }));
      if (!ok) return;

      const planRow = budgetPlan.items.find((p) => p.category_id === id);
      if (planRow) await budgetPlan.remove(planRow.id);
      await categories.remove(id);
    },
    [transactions.items, recurring.items, categories, budgetPlan, confirm, t],
  );

  /**
   * Inserts the region's starter set, translated.
   *
   * `budget-calc::presets` owns *which* categories a region gets and
   * hands back i18n keys; this composes the name actually stored, in the
   * reader's language, so a Chinese budget doesn't open with English
   * category names. Skipping a preset whose name is already present is a
   * referential check against in-memory state -- host-layer, same
   * category as `region.js` -- not a rule the core should own.
   */
  const addCommonCategories = useCallback(async () => {
    if (!wasmModule?.preset_categories) return;
    const presets = (await wasmModule.preset_categories(region)) ?? [];
    const taken = new Set(categories.items.map((c) => c.name.trim().toLowerCase()));
    for (const preset of presets) {
      const name = t(preset.key);
      const fingerprint = name.trim().toLowerCase();
      if (taken.has(fingerprint)) continue;
      taken.add(fingerprint);
      // Sequential rather than Promise.all: each save is one IndexedDB
      // write through the same store handle, and the list they land in
      // reads better in the order the presets are declared.
      // eslint-disable-next-line no-await-in-loop
      await categories.save({ id: newId(), name, group: t(preset.group_key) });
    }
    rememberSeeded();
  }, [wasmModule, region, categories, newId, t]);

  /**
   * A brand-new budget opens with the starter categories already in it,
   * rather than on a blank page with a button to press.
   *
   * Gated on `hasSeeded()` rather than on the list merely being empty:
   * someone who deletes every category, or uses "clear all data", has
   * said something, and finding the presets back on the next load would
   * be the app overriding them. `seedingRef` covers the same tick, before
   * the first save has landed in `items`.
   */
  const seedingRef = useRef(false);
  useEffect(() => {
    if (!categories.loaded || seedingRef.current || hasSeeded()) return;
    seedingRef.current = true;
    if (categories.items.length > 0) {
      // Already has categories, so this browser is not on its first run.
      // Recording that matters as much as seeding does: without it, a
      // budget created before this flag existed would get the presets
      // dumped back in the moment its owner cleared their data.
      rememberSeeded();
      return;
    }
    addCommonCategories();
  }, [categories.loaded, categories.items.length, addCommonCategories]);

  /**
   * Replaces everything in the app with the contents of an export file.
   *
   * Replace rather than merge: two files with the same record ids but
   * different contents have no correct merge without asking a person
   * about each conflict, which is the two-person merge flow the plan
   * parks for later. Replace-after-confirm is the honest version of what
   * this can do today, and the confirm says so.
   */
  const importData = useCallback(
    async (payload) => {
      const backup = readBackup(payload);
      if (!backup.ok) return { error: t(backup.reason) };

      const ok = await confirm(t('data.importConfirm', { count: backup.count }));
      if (!ok) return null;

      const byName = {
        categories,
        rules,
        transactions,
        goals,
        debts,
        recurring,
      };
      // Clear first, in reverse dependency order, so nothing is briefly
      // pointing at a category that has already gone.
      for (const name of [...COLLECTIONS].reverse()) {
        for (const item of [...byName[name].items]) {
          // eslint-disable-next-line no-await-in-loop
          await byName[name].remove(item.id);
        }
      }
      for (const item of [...budgetPlan.items]) {
        // eslint-disable-next-line no-await-in-loop
        await budgetPlan.remove(item.id);
      }

      for (const name of COLLECTIONS) {
        for (const record of backup.collections[name]) {
          // eslint-disable-next-line no-await-in-loop
          await byName[name].save(record);
        }
      }
      // Only restore plan rows belonging to the month now on screen --
      // budgetPlan is a per-month collection, and writing another month's
      // rows into it would show them under the wrong heading.
      if (backup.budgetPlan.month === month) {
        for (const entry of backup.budgetPlan.entries) {
          // eslint-disable-next-line no-await-in-loop
          await budgetPlan.save(entry);
        }
      }
      if (backup.income && backup.income.month) {
        saveIncome(backup.income.month, backup.income.amount);
      }

      // The file is the person's data now, so first-run seeding must not
      // run again on top of it.
      rememberSeeded();
      return { imported: backup.count, month: backup.budgetPlan.month };
    },
    [categories, rules, transactions, goals, debts, recurring, budgetPlan, month, confirm, t],
  );

  const clearAllData = useCallback(async () => {
    const ok = await confirm(t('data.clearConfirm'));
    if (!ok) return;
    // Emptying everything is a decision, not a fresh install -- make sure
    // the first-run seeding can't undo it on the next load.
    rememberSeeded();
    for (const collection of [transactions, budgetPlan, rules, goals, debts, recurring, categories]) {
      for (const item of [...collection.items]) {
        // eslint-disable-next-line no-await-in-loop
        await collection.remove(item.id);
      }
    }
  }, [transactions, budgetPlan, rules, goals, debts, recurring, categories, confirm, t]);

  const ActivePanel = TABS[activeTab];

  return (
    <div className="app">
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        region={region}
        onRegionChange={(next) => {
          rememberRegion(next);
          setRegion(next);
        }}
      />
      <main className="app-main">
        <Intro />
        <Suspense fallback={<TabFallback />}>
          <ActivePanel
            wasmModule={wasmModule}
            region={region}
            month={month}
            newId={newId}
            confirm={confirm}
            categories={categories}
            removeCategory={removeCategory}
            addCommonCategories={addCommonCategories}
            transactions={transactions}
            rules={rules}
            goals={goals}
            debts={debts}
            recurring={recurring}
            budgetPlan={budgetPlan}
            clearAllData={clearAllData}
            importData={importData}
          />
        </Suspense>
      </main>
      <CalcErrorPortal result={guardResult} />
      {confirmDialog}
      <UpdateBanner />
    </div>
  );
}

// Lazy-imported here too, rather than statically at the top -- it's tiny,
// but every static import at this level is one more thing every tab pays
// for on first paint regardless of which one is open.
const CalcError = React.lazy(() => import('./components/CalcError'));
function CalcErrorPortal({ result }) {
  if (!result?.error) return null;
  return (
    <Suspense fallback={null}>
      <CalcError result={result} />
    </Suspense>
  );
}

export default function App({ wasmModule }) {
  const [initialLocale] = useState(() => detectLocale());
  return (
    <I18nProvider initialLocale={initialLocale}>
      <AppShell wasmModule={wasmModule} />
    </I18nProvider>
  );
}
