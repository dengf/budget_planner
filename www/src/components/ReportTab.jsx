import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { makeFormatMoney } from '../currency';
import { monthLabel } from '../month';
import { loadIncome } from '../income';
import { EXPORT_FORMAT } from '../backup';
import { looksLikeAddress, mailtoUrl, parseRecipients } from '../mailto';
import { daysInMonth } from '../month';
import PieChart from './PieChart';
import DailySpendChart from './DailySpendChart';
import { SAVINGS_CATEGORY_ID, totalExpenseActual } from '../savings';

export default function ReportTab({
  wasmModule,
  currencySymbol,
  month,
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
  const formatMoney = makeFormatMoney(currencySymbol);
  const [lines, setLines] = useState([]);
  const [savingsLine, setSavingsLine] = useState(null);
  const [dailyTotals, setDailyTotals] = useState([]);
  const [recipients, setRecipients] = useState('');
  const income = loadIncome(month);
  const [importResult, setImportResult] = useState(null);

  const isIncome = (id) => categories.items.find((c) => c.id === id)?.is_income ?? false;

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (
        !wasmModule?.spend_by_category ||
        !wasmModule?.income_by_category ||
        !wasmModule?.daily_spend ||
        !wasmModule?.build_month
      )
        return;
      const monthTx = transactions.items.filter((tx) => tx.date?.startsWith(month));
      // Same split as BudgetTab: an income category's "actual" is what it
      // received, an expense category's is what it cost -- summing the
      // wrong side would report $0 for every income category, same as
      // the bug this fixed there.
      const [spendResult, incomeResult, dailyResult] = await Promise.all([
        wasmModule.spend_by_category({ transactions: monthTx }),
        wasmModule.income_by_category({ transactions: monthTx }),
        wasmModule.daily_spend({ transactions: monthTx }),
      ]);
      if (!cancelled) setDailyTotals(dailyResult?.totals ?? []);
      const spent = [
        ...(spendResult?.totals ?? []).filter((row) => !isIncome(row.category_id)),
        ...(incomeResult?.totals ?? []).filter((row) => isIncome(row.category_id)),
      ].map((r) => ({ category_id: r.category_id, amount: r.amount }));
      // Every known category, defaulting to 0 planned -- NOT budgetPlan.items
      // alone. `build_month` only returns lines for categories it is given a
      // planned entry for, so building this list from saved plan rows drops
      // every category that has spending but no typed budget: the report
      // printed an empty table while the Budget tab showed real spending.
      // This is the same trap CLAUDE.md documents for BudgetTab under "A new
      // category has no budget-plan entry until one is saved"; it was fixed
      // there and missed here. Don't "simplify" this back to budgetPlan.items.
      const planned = categories.items.map((c) => ({
        category_id: c.id,
        amount: budgetPlan.items.find((p) => p.category_id === c.id)?.planned ?? 0,
      }));
      const built = await wasmModule.build_month({ income, planned, previous_remaining: [], spent });
      if (!cancelled) setLines(built?.lines ?? []);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [wasmModule, budgetPlan.items, categories.items, transactions.items, month, income]);

  // Same Savings computation as BudgetTab: income minus every real expense
  // category's actual this month. Kept out of `lines` (and so out of both
  // pie charts below) since Savings isn't a category money was spent from
  // or received into -- it's the residual of the two.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!wasmModule?.build_savings_line || lines.length === 0) {
        if (!cancelled) setSavingsLine(null);
        return;
      }
      const planned = budgetPlan.items.find((p) => p.category_id === SAVINGS_CATEGORY_ID)?.planned ?? 0;
      const expense = totalExpenseActual(lines, isIncome, () => false);
      const built = await wasmModule.build_savings_line({ planned, income, total_expense_actual: expense });
      if (!cancelled) setSavingsLine(built?.line ?? null);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [wasmModule, lines, budgetPlan.items, income]);

  const categoryName = (id) => categories.items.find((c) => c.id === id)?.name ?? id;

  // Two separate breakdowns, not one chart trying to show both
  // directions of money -- `l.spent` already holds whichever of
  // spend/income applies per category (see the fetch effect above), so
  // this just needs to route each category to the side it belongs on.
  const expenseSlices = lines
    .filter((l) => !isIncome(l.category_id) && l.spent > 0)
    .map((l) => ({ id: l.category_id, label: categoryName(l.category_id), value: l.spent }));
  const incomeSlices = lines
    .filter((l) => isIncome(l.category_id) && l.spent > 0)
    .map((l) => ({ id: l.category_id, label: categoryName(l.category_id), value: l.spent }));

  const addresses = parseRecipients(recipients);
  const rejected = addresses.filter((a) => !looksLikeAddress(a));

  const bodyText = () => {
    const rows = lines
      .map((l) => `${categoryName(l.category_id)}: ${formatMoney(l.spent)} of ${formatMoney(l.planned)}`)
      .join('\n');
    const savingsRow = savingsLine
      ? `\n${t('budget.savings')}: ${formatMoney(savingsLine.spent)} of ${formatMoney(savingsLine.planned)}`
      : '';
    return `${t('report.title')} — ${monthLabel(month, locale)}\n\n${rows}${savingsRow}\n\n${t('report.generatedBy')}`;
  };

  const send = () => {
    if (addresses.length === 0 || rejected.length > 0) return;
    window.location.href = mailtoUrl({ recipients, subject: t('report.mailSubject'), body: bodyText() });
  };

  // Everything the app holds, as one file the person keeps themselves --
  // the only way to move data between devices or make a backup, since
  // there is no server this app could hold a copy on.
  const exportData = () => {
    const payload = {
      format: EXPORT_FORMAT,
      exported_at: new Date().toISOString(),
      categories: categories.items,
      transactions: transactions.items,
      rules: rules.items,
      goals: goals.items,
      debts: debts.items,
      recurring: recurring.items,
      // Only the currently loaded month -- budget-plan rows are fetched
      // per month, and this app has no "every month" listing to export.
      budget_plan: { month, entries: budgetPlan.items },
      // Income lives in localStorage, not the store, so it has to be
      // named explicitly here. Leaving it out meant a restore came back
      // with every summary figure wrong until it was retyped.
      income: { month, amount: income },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `budget-planner-${month}.json`;
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

  return (
    <div className="panel report">
      <h2>{t('report.title')}</h2>
      <p className="panel-subtitle">{t('report.subtitle')} · {monthLabel(month, locale)}</p>

      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>{t('budget.categoryName')}</th>
              <th>{t('budget.planned')}</th>
              <th>{t('budget.actual')}</th>
              <th>{t('budget.remaining')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              // Same reframing as the Budget tab: `remaining >= 0` is
              // always fine regardless of direction (nothing planned,
              // nothing happened, or still on track). Only a *negative*
              // remaining differs by direction -- overspending for an
              // expense category (bad, red) versus income landing ahead
              // of plan for an income one (good) -- the same raw number
              // reads oppositely depending on which side of the ledger
              // it's on.
              const isGoodNews = l.remaining >= 0 || isIncome(l.category_id);
              return (
                <tr key={l.category_id}>
                  <td>{categoryName(l.category_id)}</td>
                  <td className="num">{formatMoney(l.planned)}</td>
                  <td className="num">{formatMoney(l.spent)}</td>
                  <td className={`num ${isGoodNews ? 'positive' : 'negative'}`}>{formatMoney(l.remaining)}</td>
                </tr>
              );
            })}
            {savingsLine && (
              <tr className="report-savings-row">
                <td>{t('budget.savings')}</td>
                <td className="num">{formatMoney(savingsLine.planned)}</td>
                <td className="num">{formatMoney(savingsLine.spent)}</td>
                <td className="num positive">{formatMoney(savingsLine.remaining)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <DailySpendChart
        totals={dailyTotals}
        month={month}
        daysInMonth={daysInMonth(month)}
        formatMoney={formatMoney}
      />

      <div className="report-pies">
        <PieChart
          title={t('chart.expenseBreakdown')}
          items={expenseSlices}
          formatMoney={formatMoney}
          ariaLabel={t('chart.expenseBreakdownAria', { month: monthLabel(month, locale) })}
        />
        <PieChart
          title={t('chart.incomeBreakdown')}
          items={incomeSlices}
          formatMoney={formatMoney}
          ariaLabel={t('chart.incomeBreakdownAria', { month: monthLabel(month, locale) })}
        />
      </div>

      {goals.items.length > 0 && (
        <>
          <h2>{t('goals.title')}</h2>
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th>{t('goals.name')}</th><th>{t('goals.current')}</th><th>{t('goals.target')}</th></tr></thead>
              <tbody>
                {goals.items.map((g) => (
                  <tr key={g.id}><td>{g.name}</td><td className="num">{formatMoney(g.current_amount)}</td><td className="num">{formatMoney(g.target_amount)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {debts.items.length > 0 && (
        <>
          <h2>{t('debt.title')}</h2>
          <div className="table-scroll">
            <table className="data">
              <thead><tr><th>{t('debt.name')}</th><th>{t('debt.balance')}</th><th>{t('debt.minPayment')}</th></tr></thead>
              <tbody>
                {debts.items.map((d) => (
                  <tr key={d.id}><td>{d.name}</td><td className="num">{formatMoney(d.balance)}</td><td className="num">{formatMoney(d.min_payment)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="report-actions no-print">
        <button className="btn" onClick={() => window.print()}>{t('report.print')}</button>
      </div>

      <div className="form-grid no-print">
        <label className="field">
          <span className="field-label">{t('report.recipients')}</span>
          <div className="field-input">
            <input value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder={t('report.recipientsPlaceholder')} />
          </div>
        </label>
        <button className="btn secondary" onClick={send} disabled={addresses.length === 0 || rejected.length > 0}>
          {t('report.send')}
        </button>
      </div>

      <div className="data-management no-print">
        <h2>{t('data.title')}</h2>
        <p className="panel-subtitle">{t('data.exportHint')}</p>
        <div className="data-management-actions">
          <button className="btn secondary" onClick={exportData}>{t('data.export')}</button>
          <label className="btn secondary import-button">
            {t('data.import')}
            <input type="file" accept="application/json,.json" onChange={onImportFile} />
          </label>
          <button className="btn danger" onClick={clearAllData}>{t('data.clearAll')}</button>
        </div>
        {importResult?.error && <p className="import-error" role="alert">{importResult.error}</p>}
        {importResult?.imported != null && (
          <p className="headline">{t('data.imported', { count: importResult.imported })}</p>
        )}
      </div>
    </div>
  );
}
