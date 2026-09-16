import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { makeFormatMoney } from '../currency';
import { monthLabel, monthsBetween, todayIso } from '../month';
import { useMonthSavings } from '../monthSavings';
import BlossomProgress from './BlossomProgress';
import CalcError from './CalcError';
import NumberField from './NumberField';

const CADENCES = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];

function GoalCard({
  goal,
  wasmModule,
  formatMoney,
  t,
  locale,
  month,
  unallocated,
  confirm,
  onSave,
  onRemove,
}) {
  const [progress, setProgress] = useState(null);
  const [contribution, setContribution] = useState(null);
  const [addAmount, setAddAmount] = useState('');
  const [milestoneMsg, setMilestoneMsg] = useState(null);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!wasmModule?.goal_progress || !wasmModule?.required_contribution) return;
      const p = await wasmModule.goal_progress({
        current_amount: goal.current_amount,
        target_amount: goal.target_amount,
      });
      const months = monthsBetween(todayIso(), goal.target_date);
      const c = await wasmModule.required_contribution({
        target_amount: goal.target_amount,
        current_amount: goal.current_amount,
        months_remaining: months,
        cadence: goal.cadence,
      });
      if (!cancelled) {
        setProgress(p);
        setContribution(c);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [wasmModule, goal.current_amount, goal.target_amount, goal.target_date, goal.cadence]);

  // Both the typed amount and the one-tap "add this month's savings"
  // land here. Neither adds anything up in JS: `goal_contribution`
  // returns the whole updated goal -- new balance *and* the month it was
  // credited to -- and that is what gets stored, in one save. Splitting
  // the two apart is how a month's savings ends up counted twice.
  const addFunds = async (amount) => {
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (!wasmModule?.goal_contribution) return;
    const result = await wasmModule.goal_contribution({ goal, month, amount });
    if (result?.error) {
      setSaveError(result);
      return;
    }
    setSaveError(null);
    await onSave(result.goal);
    setAddAmount('');
    setMilestoneMsg(
      result.milestone ? t(`goals.milestone.${result.milestone}`, { name: goal.name }) : null,
    );
  };

  const submitTyped = (e) => {
    e.preventDefault();
    addFunds(Number(addAmount));
  };

  return (
    <div className="goal-card">
      <BlossomProgress filled={progress?.petals_filled ?? 0} />
      <div className="goal-info">
        <span className="goal-name">{goal.name}</span>
        <span className="goal-progress-text">
          {formatMoney(goal.current_amount)} / {formatMoney(goal.target_amount)}
        </span>
        {contribution?.amount != null && (
          <span className="goal-contribution">
            {t('goals.requiredContribution', {
              amount: formatMoney(contribution.amount),
              cadence: t(`freq.${goal.cadence}`),
            })}
          </span>
        )}
        {milestoneMsg && <span className="goal-milestone">{milestoneMsg}</span>}
        {saveError && <CalcError result={saveError} />}
        {unallocated > 0 && (
          <button
            type="button"
            className="btn secondary goal-assign"
            onClick={() => addFunds(unallocated)}
          >
            {t('goals.assignSavings', {
              month: monthLabel(month, locale),
              amount: formatMoney(unallocated),
            })}
          </button>
        )}
      </div>
      <form className="field-input goal-add-form" onSubmit={submitTyped}>
        <input
          type="number"
          step="any"
          placeholder={t('goals.current')}
          aria-label={t('goals.addToGoal', { name: goal.name })}
          value={addAmount}
          onChange={(e) => setAddAmount(e.target.value)}
        />
      </form>
      <button className="btn secondary" onClick={submitTyped}>
        +
      </button>
      <button
        className="btn danger"
        onClick={async () => {
          const ok = await confirm(t('confirm.removeGoal', { name: goal.name }));
          if (ok) onRemove(goal.id);
        }}
      >
        {t('budget.remove')}
      </button>
    </div>
  );
}

export default function GoalsTab({
  wasmModule,
  currencySymbol,
  newId,
  confirm,
  goals,
  transactions,
  categories,
  budgetPlan,
  viewMonth,
}) {
  const { t, locale } = useI18n();
  const formatMoney = makeFormatMoney(currencySymbol);
  const [draft, setDraft] = useState({
    name: '',
    target_amount: '',
    target_date: '',
    cadence: 'monthly',
  });

  // What the month actually saved, and how much of it no goal has
  // claimed yet. Both come from Rust: the residual from
  // `build_savings_line` (via the hook), the subtraction from
  // `unallocated_savings`.
  const savings = useMonthSavings({ wasmModule, transactions, categories, budgetPlan, viewMonth });
  const [unallocatedResult, setUnallocatedResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!wasmModule?.unallocated_savings || savings == null) {
        if (!cancelled) setUnallocatedResult(null);
        return;
      }
      const result = await wasmModule.unallocated_savings({
        savings_actual: savings,
        goals: goals.items,
        month: viewMonth,
      });
      if (!cancelled) setUnallocatedResult(result?.error ? null : result);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [wasmModule, savings, goals.items, viewMonth]);

  const unallocated = unallocatedResult?.amount ?? 0;

  const addGoal = async (e) => {
    e.preventDefault();
    if (!draft.name.trim() || !draft.target_amount || !draft.target_date) return;
    await goals.save({
      id: newId(),
      name: draft.name,
      target_amount: Number(draft.target_amount),
      current_amount: 0,
      target_date: draft.target_date,
      cadence: draft.cadence,
      contributions: [],
    });
    setDraft({ name: '', target_amount: '', target_date: '', cadence: 'monthly' });
  };

  return (
    <div className="panel">
      <h2>{t('goals.title')}</h2>

      {/* Only once there are goals to put it in -- on an empty Goals
          screen a savings figure is a number with nowhere to go, and the
          empty state's job is to get the first goal created. */}
      {goals.items.length > 0 && unallocatedResult && (
        <p className="goal-savings-banner">
          {/* Four different true things, never one line stretched over
              all of them -- which of the four is `budget-calc`'s call,
              not a comparison made here: "all of it is assigned" and
              "more than the month saved is assigned" both leave the
              unallocated figure at zero, and only the state tells them
              apart. See `budget_calc::savings_allocation_state`. */}
          {{
            nothing_saved: () => t('goals.savingsNone', { month: monthLabel(viewMonth, locale) }),
            unallocated: () =>
              t('goals.savingsAvailable', {
                month: monthLabel(viewMonth, locale),
                amount: formatMoney(unallocated),
              }),
            fully_allocated: () =>
              t('goals.savingsAllAssigned', {
                month: monthLabel(viewMonth, locale),
                amount: formatMoney(unallocatedResult?.allocated ?? 0),
              }),
            over_allocated: () =>
              t('goals.savingsOverAssigned', {
                month: monthLabel(viewMonth, locale),
                assigned: formatMoney(unallocatedResult?.allocated ?? 0),
                saved: formatMoney(savings),
              }),
          }[unallocatedResult?.state]?.() ?? null}
        </p>
      )}

      {goals.items.length === 0 ? (
        <p className="empty-state">{t('goals.noGoals')}</p>
      ) : (
        <div className="goal-list">
          {goals.items.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              wasmModule={wasmModule}
              formatMoney={formatMoney}
              t={t}
              locale={locale}
              month={viewMonth}
              unallocated={unallocated}
              confirm={confirm}
              onSave={goals.save}
              onRemove={goals.remove}
            />
          ))}
        </div>
      )}

      <form className="form-grid" onSubmit={addGoal}>
        <label className="field">
          <span className="field-label">{t('goals.name')}</span>
          <div className="field-input">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
        </label>
        <NumberField
          label={t('goals.target')}
          value={draft.target_amount}
          onChange={(v) => setDraft({ ...draft, target_amount: v })}
          grouped
        />
        <label className="field">
          <span className="field-label">{t('goals.targetDate')}</span>
          <div className="field-input">
            <input
              type="date"
              value={draft.target_date}
              onChange={(e) => setDraft({ ...draft, target_date: e.target.value })}
            />
          </div>
        </label>
        <label className="field">
          <span className="field-label">{t('goals.cadence')}</span>
          <select
            className="field-select"
            value={draft.cadence}
            onChange={(e) => setDraft({ ...draft, cadence: e.target.value })}
          >
            {CADENCES.map((c) => (
              <option key={c} value={c}>
                {t(`freq.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" type="submit">
          {t('goals.add')}
        </button>
      </form>
    </div>
  );
}
