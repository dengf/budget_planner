import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Header from './components/Header';
import Intro from './components/Intro';
import { useConfirm } from './components/ConfirmDialog';
import { I18nProvider, detectLocale, useI18n } from './i18n';
import { loadCurrencySymbol, saveCurrencySymbol } from './currencySymbol';
import UpdateBanner from './components/UpdateBanner';
import { COLLECTIONS, readBackup } from './backup';
import { currentMonth } from './month';

// Code-split: a visitor logging one transaction shouldn't download the
// debt-payoff engine's UI too. Each tab's component (and everything it
// imports) only loads the first time its tab is opened.
const DashboardTab = React.lazy(() => import('./components/DashboardTab'));
const BudgetTab = React.lazy(() => import('./components/BudgetTab'));
const TransactionsTab = React.lazy(() => import('./components/TransactionsTab'));
const GoalsTab = React.lazy(() => import('./components/GoalsTab'));
const DebtTab = React.lazy(() => import('./components/DebtTab'));

const TABS = {
  dashboard: DashboardTab,
  budget: BudgetTab,
  transactions: TransactionsTab,
  goals: GoalsTab,
  debt: DebtTab,
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
  const [activeTab, setActiveTab] = useState('dashboard');
  const [currencySymbol, setCurrencySymbol] = useState(() => loadCurrencySymbol());
  // `today` is the real, unchanging current month -- an anchor for "is the
  // month on screen the real current one" comparisons. `viewMonth` is
  // whatever month is actually being browsed/edited right now, shared
  // across Dashboard/Budget/Transactions so picking a month in one tab
  // is still picked when another tab opens.
  const [today] = useState(() => currentMonth());
  const [viewMonth, setViewMonth] = useState(today);
  const { t } = useI18n();
  const [confirm, confirmDialog] = useConfirm();
  const [guardResult, setGuardResult] = useState(null);

  const categories = useCollection(
    wasmModule,
    'list_categories',
    'save_category',
    'delete_category',
  );
  const transactions = useCollection(
    wasmModule,
    'list_transactions',
    'save_transaction',
    'delete_transaction',
  );
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
    viewMonth,
  );

  const newId = useCallback(
    () => (wasmModule?.new_id ? wasmModule.new_id() : `local-${Date.now()}`),
    [wasmModule],
  );

  /**
   * A deleted category used to leave its raw id string on screen wherever
   * a transaction still pointed at it (BudgetTab and DashboardTab's
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
      const ok = await confirm(
        t('confirm.removeCategory', {
          name: categories.items.find((c) => c.id === id)?.name ?? id,
        }),
      );
      if (!ok) return;

      const planRow = budgetPlan.items.find((p) => p.category_id === id);
      if (planRow) await budgetPlan.remove(planRow.id);
      await categories.remove(id);
    },
    [transactions.items, recurring.items, categories, budgetPlan, confirm, t],
  );

  /**
   * Inserts the starter set, translated.
   *
   * `budget-calc::presets` hands back i18n keys; this composes the name
   * actually stored, in the reader's language, so a Chinese budget
   * doesn't open with English category names. Skipping a preset whose
   * name is already present is a referential check against in-memory
   * state -- host-layer, not a rule the core should own.
   *
   * `existingItems` defaults to the live `categories.items`, but takes an
   * explicit override for callers that just mutated categories themselves
   * in the same tick (`clearAllData` below): `categories.items` here is a
   * plain closure over this render's state, not a live view, so it still
   * reads the pre-clear list until React re-renders -- passing `[]`
   * directly is what keeps every preset from being wrongly skipped as
   * "already taken."
   */
  const addCommonCategories = useCallback(
    async (existingItems = categories.items) => {
      if (!wasmModule?.preset_categories) return;
      const presets = (await wasmModule.preset_categories()) ?? [];
      const taken = new Set(existingItems.map((c) => c.name.trim().toLowerCase()));
      for (const preset of presets) {
        const name = t(preset.key);
        const fingerprint = name.trim().toLowerCase();
        if (taken.has(fingerprint)) continue;
        taken.add(fingerprint);
        // Sequential rather than Promise.all: each save is one IndexedDB
        // write through the same store handle, and the list they land in
        // reads better in the order the presets are declared.
        // eslint-disable-next-line no-await-in-loop
        await categories.save({
          id: newId(),
          name,
          group: t(preset.group_key),
          is_income: preset.is_income,
          description: t(preset.description_key),
          preset_key: preset.key,
        });
      }
    },
    [wasmModule, categories, newId, t],
  );

  /**
   * A budget with zero categories opens with the starter set already in
   * it, rather than on a blank page with a button to press -- true on a
   * genuine first run, and true again of any later fresh load that finds
   * the list empty, for the same reason: an empty category list is never
   * actually the useful state to land on.
   *
   * `seedingRef` makes this decision exactly once *per mount*, the moment
   * `categories` finishes its first load, whichever way it goes -- so
   * deleting categories down to zero one at a time by hand doesn't refill
   * the list out from under someone mid-edit. `clearAllData` below is the
   * one deliberate exception: it calls `addCommonCategories` itself right
   * after clearing, so a reset lands back on the same "starter set, not a
   * blank page" state a fresh visitor gets, without waiting for a reload.
   *
   * An earlier version left a full page reload as the only way back to
   * the starter set after "Clear all data," reasoning that an explicit
   * "Add common categories" button was reachable by hand. In practice
   * that read as the button being broken -- a clear that doesn't restore
   * anything looks identical to one that silently failed. Re-seeding
   * immediately is the cheaper mistake versus leaving a deliberately
   * emptied budget looking uninitialized.
   */
  const seedingRef = useRef(false);
  useEffect(() => {
    if (!categories.loaded || seedingRef.current) return;
    seedingRef.current = true;
    if (categories.items.length === 0) addCommonCategories();
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

      const ok = await confirm(
        t('data.importConfirm', { count: backup.count }),
        t('confirm.replace'),
      );
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
      if (backup.budgetPlan.month === viewMonth) {
        for (const entry of backup.budgetPlan.entries) {
          // eslint-disable-next-line no-await-in-loop
          await budgetPlan.save(entry);
        }
      }
      // No separate income restore: income is derived from the categories
      // and budget-plan entries just restored above (see DashboardTab's
      // exportData for why the export itself carries nothing else).

      return { imported: backup.count, month: backup.budgetPlan.month };
    },
    [categories, rules, transactions, goals, debts, recurring, budgetPlan, viewMonth, confirm, t],
  );

  const clearAllData = useCallback(async () => {
    const ok = await confirm(t('data.clearConfirm'), t('data.clearAll'));
    if (!ok) return;
    for (const collection of [
      transactions,
      budgetPlan,
      rules,
      goals,
      debts,
      recurring,
      categories,
    ]) {
      for (const item of [...collection.items]) {
        // eslint-disable-next-line no-await-in-loop
        await collection.remove(item.id);
      }
    }
    // Land back on the same starter-set state a fresh visitor gets,
    // rather than an empty category list that looks uninitialized --
    // see the `seedingRef` comment above for why this can't just rely
    // on that effect re-running. `[]` explicitly, not the default
    // `categories.items` -- the removal loop above just emptied it, but
    // this closure's own `categories.items` still reads the pre-clear
    // list until a re-render catches up.
    await addCommonCategories([]);
  }, [
    transactions,
    budgetPlan,
    rules,
    goals,
    debts,
    recurring,
    categories,
    confirm,
    t,
    addCommonCategories,
  ]);

  const ActivePanel = TABS[activeTab];

  return (
    <div className="app">
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        currencySymbol={currencySymbol}
        onCurrencySymbolChange={(next) => {
          saveCurrencySymbol(next);
          setCurrencySymbol(next);
        }}
        wasmModule={wasmModule}
        today={today}
        viewMonth={viewMonth}
        categories={categories}
        transactions={transactions}
        rules={rules}
        budgetPlan={budgetPlan}
        goals={goals}
        debts={debts}
        recurring={recurring}
        clearAllData={clearAllData}
        importData={importData}
      />
      <main className="app-main">
        <Suspense fallback={<TabFallback />}>
          <ActivePanel
            wasmModule={wasmModule}
            currencySymbol={currencySymbol}
            today={today}
            viewMonth={viewMonth}
            setViewMonth={setViewMonth}
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
          />
        </Suspense>
        <Intro />
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
