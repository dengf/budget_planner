import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { makeFormatMoney } from '../currency';
import { monthsBetween, todayIso } from '../month';
import BlossomProgress from './BlossomProgress';
import NumberField from './NumberField';

const CADENCES = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];

function GoalCard({ goal, wasmModule, formatMoney, t, confirm, onSave, onRemove }) {
  const [progress, setProgress] = useState(null);
  const [contribution, setContribution] = useState(null);
  const [addAmount, setAddAmount] = useState('');
  const [milestoneMsg, setMilestoneMsg] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!wasmModule?.goal_progress || !wasmModule?.required_contribution) return;
      const p = await wasmModule.goal_progress({ current_amount: goal.current_amount, target_amount: goal.target_amount });
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

  const addFunds = async (e) => {
    e.preventDefault();
    const delta = Number(addAmount);
    if (!Number.isFinite(delta) || delta === 0) return;

    const previous = goal.current_amount;
    const next = previous + delta;
    const milestoneResult = wasmModule?.milestone_crossed
      ? await wasmModule.milestone_crossed({ previous_amount: previous, new_amount: next, target_amount: goal.target_amount })
      : null;
    await onSave({ ...goal, current_amount: next });
    setAddAmount('');
    setMilestoneMsg(milestoneResult?.milestone ? t(`goals.milestone.${milestoneResult.milestone}`, { name: goal.name }) : null);
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
            {t('goals.requiredContribution', { amount: formatMoney(contribution.amount), cadence: t(`freq.${goal.cadence}`) })}
          </span>
        )}
        {milestoneMsg && <span className="goal-milestone">{milestoneMsg}</span>}
      </div>
      <form className="field-input goal-add-form" onSubmit={addFunds}>
        <input
          type="number"
          step="any"
          placeholder={t('goals.current')}
          value={addAmount}
          onChange={(e) => setAddAmount(e.target.value)}
        />
      </form>
      <button className="btn secondary" onClick={addFunds}>+</button>
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

export default function GoalsTab({ wasmModule, currencySymbol, newId, confirm, goals }) {
  const { t } = useI18n();
  const formatMoney = makeFormatMoney(currencySymbol);
  const [draft, setDraft] = useState({ name: '', target_amount: '', target_date: '', cadence: 'monthly' });

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
    });
    setDraft({ name: '', target_amount: '', target_date: '', cadence: 'monthly' });
  };

  return (
    <div className="panel">
      <h2>{t('goals.title')}</h2>

      {goals.items.length === 0 ? (
        <p className="empty-state">{t('goals.noGoals')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {goals.items.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              wasmModule={wasmModule}
              formatMoney={formatMoney}
              t={t}
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
          <div className="field-input"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
        </label>
        <NumberField
          label={t('goals.target')}
          value={draft.target_amount}
          onChange={(v) => setDraft({ ...draft, target_amount: v })}
          grouped
        />
        <label className="field">
          <span className="field-label">{t('goals.targetDate')}</span>
          <div className="field-input"><input type="date" value={draft.target_date} onChange={(e) => setDraft({ ...draft, target_date: e.target.value })} /></div>
        </label>
        <label className="field">
          <span className="field-label">{t('goals.cadence')}</span>
          <select className="field-select" value={draft.cadence} onChange={(e) => setDraft({ ...draft, cadence: e.target.value })}>
            {CADENCES.map((c) => <option key={c} value={c}>{t(`freq.${c}`)}</option>)}
          </select>
        </label>
        <button className="btn" type="submit">{t('goals.add')}</button>
      </form>
    </div>
  );
}
