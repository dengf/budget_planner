import React, { useCallback, useEffect, useState } from 'react';
import Header from './components/Header';
import Intro from './components/Intro';
import BudgetTab from './components/BudgetTab';
import TransactionsTab from './components/TransactionsTab';
import GoalsTab from './components/GoalsTab';
import DebtTab from './components/DebtTab';
import ReportTab from './components/ReportTab';
import { I18nProvider, detectLocale, useI18n } from './i18n';
import { detectRegion, rememberRegion } from './region';
import { currentMonth } from './month';

const TABS = {
  budget: BudgetTab,
  transactions: TransactionsTab,
  goals: GoalsTab,
  debt: DebtTab,
  report: ReportTab,
};

/**
 * Every collection this app persists, loaded once wasm storage is ready
 * and kept in memory from then on -- writes go to storage and to this
 * state together, optimistically, the same pattern mortgage_calculator's
 * SavedScenarios uses for a single collection, generalized to six.
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
      if (!result?.error) await reload();
      return result;
    },
    [wasmModule, reload],
  );

  const remove = useCallback(
    async (id) => {
      if (!wasmModule?.[deleteFn]) return;
      await wasmModule[deleteFn](id);
      await reload();
    },
    [wasmModule, reload],
  );

  return { items, loaded, save, remove, reload };
}

export function AppShell({ wasmModule }) {
  const [activeTab, setActiveTab] = useState('budget');
  const [region, setRegion] = useState(() => detectRegion());
  const [month] = useState(() => currentMonth());
  const { t } = useI18n();

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
        <ActivePanel
          wasmModule={wasmModule}
          region={region}
          month={month}
          newId={newId}
          categories={categories}
          transactions={transactions}
          rules={rules}
          goals={goals}
          debts={debts}
          budgetPlan={budgetPlan}
        />
      </main>
    </div>
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
