import React, { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import { makeFormatMoney } from '../currency';
import { daysLeftInMonth, monthLabel } from '../month';
import { loadIncome, saveIncome } from '../income';
import NumberField from './NumberField';
import CalcError from './CalcError';

/**
 * `previous_remaining` (rollover) is passed as `[]` -- every month is
 * planned independently for now. `budget-calc::build_month` already
 * accepts a prior month's remaining balances; wiring the frontend to
 * carry them forward month-over-month is real, sizeable state (finding
 * and summing the actual previous month) left for a follow-up round
 * rather than this one.
 */
export default function BudgetTab({ wasmModule, region, month, categories, removeCategory, transactions, budgetPlan }) {
  const { t, locale } = useI18n();
  const formatMoney = makeFormatMoney(region);
  const [income, setIncome] = useState(() => loadIncome(month));
  const [result, setResult] = useState(null);
  const [newCategory, setNewCategory] = useState({ name: '', group: '' });
  const [plannedDraft, setPlannedDraft] = useState({});

  useEffect(() => {
    saveIncome(month, income);
  }, [month, income]);

  const monthTransactions = useMemo(
    () => transactions.items.filter((tx) => tx.date?.startsWith(month)),
    [transactions.items, month],
  );

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!wasmModule?.spend_by_category || !wasmModule?.build_month) return;
      const spendResult = await wasmModule.spend_by_category({ transactions: monthTransactions });
      const spent = (spendResult?.totals ?? []).map((t) => ({ category_id: t.category_id, amount: t.amount }));
      // Every known category gets a planned line, defaulting to 0 -- not
      // only the ones with a saved plan entry. Otherwise a category
      // freshly added this session has nothing to type an amount into: it
      // exists, but build_month never hears about it until something else
      // creates a plan row for it first.
      const planned = categories.items.map((c) => ({
        category_id: c.id,
        amount: budgetPlan.items.find((p) => p.category_id === c.id)?.planned ?? 0,
      }));
      const built = await wasmModule.build_month({ income, planned, previous_remaining: [], spent });
      if (!cancelled) setResult(built);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [wasmModule, income, budgetPlan.items, categories.items, monthTransactions]);

  const categoryName = (id) => categories.items.find((c) => c.id === id)?.name ?? id;

  const addCategory = async (e) => {
    e.preventDefault();
    if (!newCategory.name.trim()) return;
    const id = wasmModule?.new_id ? wasmModule.new_id() : `local-${Date.now()}`;
    await categories.save({ id, name: newCategory.name, group: newCategory.group || 'General' });
    setNewCategory({ name: '', group: '' });
  };

  const savePlanned = async (categoryId, amount) => {
    const existing = budgetPlan.items.find((p) => p.category_id === categoryId);
    const id = existing?.id ?? (wasmModule?.new_id ? wasmModule.new_id() : `local-${Date.now()}`);
    await budgetPlan.save({ id, month, category_id: categoryId, planned: Number(amount) || 0 });
  };

  const days = daysLeftInMonth();
  const summary = result?.summary;
  const unassigned = summary?.unassigned ?? 0;

  return (
    <div className="panel">
      <h2>{t('budget.title')} · {monthLabel(month, locale)}</h2>
      <p className="headline">{t('budget.daysLeft', { days, month: monthLabel(month, locale) })}</p>

      <div className="form-grid">
        <NumberField
          label={t('budget.income')}
          value={income}
          onChange={(v) => setIncome(v === '' ? 0 : v)}
          suffix={formatMoney(0).replace(/[\d.,]/g, '')}
          grouped
        />
      </div>

      {result?.error && <CalcError result={result} />}

      {summary && (
        <div className="stat-grid">
          <div className="stat stat-primary">
            <span className="stat-label">{t('budget.income')}</span>
            <span className="stat-value">{formatMoney(summary.income)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">{t('budget.totalPlanned')}</span>
            <span className="stat-value">{formatMoney(summary.total_planned)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">{t('budget.totalSpent')}</span>
            <span className="stat-value">{formatMoney(summary.total_spent)}</span>
          </div>
          <div className={unassigned < 0 ? 'stat stat-negative' : 'stat'}>
            <span className="stat-label">
              {unassigned === 0
                ? t('budget.fullyAssigned')
                : unassigned > 0
                  ? t('budget.unassignedPositive', { amount: formatMoney(unassigned) })
                  : t('budget.unassignedNegative', { amount: formatMoney(-unassigned) })}
            </span>
            <span className="stat-value">{formatMoney(unassigned)}</span>
          </div>
        </div>
      )}

      {categories.items.length === 0 ? (
        <p className="empty-state">{t('budget.noCategories')}</p>
      ) : (
        <div>
          {(result?.lines ?? []).map((line) => (
            <div className="category-row" key={line.category_id}>
              <div>
                <div className="category-name">{categoryName(line.category_id)}</div>
                <div className="category-group">{categories.items.find((c) => c.id === line.category_id)?.group}</div>
              </div>
              <div className="num">
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={plannedDraft[line.category_id] ?? line.planned}
                  className="field-input"
                  style={{ width: '100%' }}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setPlannedDraft((d) => ({ ...d, [line.category_id]: raw }));
                    savePlanned(line.category_id, raw);
                  }}
                />
              </div>
              <div className="num">{formatMoney(line.spent)}</div>
              <div className={`num ${line.remaining < 0 ? 'negative' : 'positive'}`}>
                {line.remaining < 0
                  ? t('budget.borrowed', { amount: formatMoney(-line.remaining) })
                  : formatMoney(line.remaining)}
              </div>
              <div />
              <button className="btn danger" onClick={() => removeCategory(line.category_id)}>
                {t('budget.remove')}
              </button>
            </div>
          ))}
        </div>
      )}

      <form className="form-grid" onSubmit={addCategory}>
        <label className="field">
          <span className="field-label">{t('budget.categoryName')}</span>
          <div className="field-input">
            <input value={newCategory.name} onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })} />
          </div>
        </label>
        <label className="field">
          <span className="field-label">{t('budget.categoryGroup')}</span>
          <div className="field-input">
            <input value={newCategory.group} onChange={(e) => setNewCategory({ ...newCategory, group: e.target.value })} />
          </div>
        </label>
        <button className="btn" type="submit">{t('budget.addCategory')}</button>
      </form>
    </div>
  );
}
