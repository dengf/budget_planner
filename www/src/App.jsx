import React, { Suspense, useCallback, useEffect, useState } from 'react';
import Header from './components/Header';
import Intro from './components/Intro';
import { useConfirm } from './components/ConfirmDialog';
import { I18nProvider, detectLocale, useI18n } from './i18n';
import { detectRegion, rememberRegion } from './region';
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
   */
  const removeCategory = useCallback(
    async (id) => {
      const inUse = transactions.items.filter((t) => t.category_id === id);
      if (inUse.length > 0) {
        const category = categories.items.find((c) => c.id === id);
        setGuardResult({
          error: t('err.categoryInUse', { name: category?.name ?? id, count: inUse.length }),
        });
        return;
      }
      const ok = await confirm(t('confirm.removeCategory', { name: categories.items.find((c) => c.id === id)?.name ?? id }));
      if (!ok) return;

      const planRow = budgetPlan.items.find((p) => p.category_id === id);
      if (planRow) await budgetPlan.remove(planRow.id);
      await categories.remove(id);
    },
    [transactions.items, categories, budgetPlan, confirm, t],
  );

  const clearAllData = useCallback(async () => {
    const ok = await confirm(t('data.clearConfirm'));
    if (!ok) return;
    for (const collection of [transactions, budgetPlan, rules, goals, debts, categories]) {
      for (const item of [...collection.items]) {
        // eslint-disable-next-line no-await-in-loop
        await collection.remove(item.id);
      }
    }
  }, [transactions, budgetPlan, rules, goals, debts, categories, confirm, t]);

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
            transactions={transactions}
            rules={rules}
            goals={goals}
            debts={debts}
            budgetPlan={budgetPlan}
            clearAllData={clearAllData}
          />
        </Suspense>
      </main>
      <CalcErrorPortal result={guardResult} />
      {confirmDialog}
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
