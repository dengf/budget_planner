import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { makeFormatMoney } from '../currency';
import NumberField from './NumberField';
import CalcError from './CalcError';
import DebtChart from './DebtChart';

export default function DebtTab({ wasmModule, currencySymbol, newId, confirm, debts }) {
  const { t } = useI18n();
  const formatMoney = makeFormatMoney(currencySymbol);
  const [draft, setDraft] = useState({ name: '', balance: '', apr_percent: '', min_payment: '' });
  const [extraPayment, setExtraPayment] = useState(0);
  const [strategy, setStrategy] = useState('snowball');
  const [plan, setPlan] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!wasmModule?.build_payoff_plan || debts.items.length === 0) {
        setPlan(null);
        return;
      }
      const result = await wasmModule.build_payoff_plan({
        debts: debts.items,
        extra_payment: Number(extraPayment) || 0,
        strategy,
        max_months: 600,
      });
      if (!cancelled) setPlan(result);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [wasmModule, debts.items, extraPayment, strategy]);

  const addDebt = async (e) => {
    e.preventDefault();
    if (!draft.name.trim() || !draft.balance || !draft.min_payment) return;
    await debts.save({
      id: newId(),
      name: draft.name,
      balance: Number(draft.balance),
      apr_percent: Number(draft.apr_percent) || 0,
      min_payment: Number(draft.min_payment),
    });
    setDraft({ name: '', balance: '', apr_percent: '', min_payment: '' });
  };

  const debtName = (id) => debts.items.find((d) => d.id === id)?.name ?? id;
  const firstMonthRows = (plan?.schedule ?? []).filter((row) => row.month === 1);

  const removeDebt = async (debt) => {
    const ok = await confirm(t('confirm.removeDebt', { name: debt.name }));
    if (ok) await debts.remove(debt.id);
  };

  return (
    <div className="panel">
      <h2>{t('debt.title')}</h2>

      {debts.items.length === 0 ? (
        <p className="empty-state">{t('debt.noDebts')}</p>
      ) : (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>{t('debt.name')}</th>
                <th>{t('debt.balance')}</th>
                <th>{t('debt.apr')}</th>
                <th>{t('debt.minPayment')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {debts.items.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td className="num">{formatMoney(d.balance)}</td>
                  <td className="num">{d.apr_percent.toFixed(2)}%</td>
                  <td className="num">{formatMoney(d.min_payment)}</td>
                  <td><button className="btn ghost" onClick={() => removeDebt(d)}>{t('budget.remove')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form className="form-grid" onSubmit={addDebt}>
        <label className="field">
          <span className="field-label">{t('debt.name')}</span>
          <div className="field-input"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
        </label>
        <NumberField label={t('debt.balance')} value={draft.balance} onChange={(v) => setDraft({ ...draft, balance: v })} grouped />
        <NumberField label={t('debt.apr')} value={draft.apr_percent} onChange={(v) => setDraft({ ...draft, apr_percent: v })} suffix="%" />
        <NumberField label={t('debt.minPayment')} value={draft.min_payment} onChange={(v) => setDraft({ ...draft, min_payment: v })} grouped />
        <button className="btn" type="submit">{t('debt.add')}</button>
      </form>

      {debts.items.length > 0 && (
        <>
          <div className="form-grid">
            <NumberField label={t('debt.extraPayment')} value={extraPayment} onChange={setExtraPayment} grouped />
            <label className="field">
              <span className="field-label">{t('debt.strategy')}</span>
              <select className="field-select" value={strategy} onChange={(e) => setStrategy(e.target.value)}>
                <option value="snowball">{t('debt.snowball')}</option>
                <option value="avalanche">{t('debt.avalanche')}</option>
              </select>
            </label>
          </div>

          {plan?.error && <CalcError result={plan} />}

          {plan && !plan.error && (
            <>
              <p className="headline">
                {t('debt.monthsToDebtFree', { months: plan.months_to_debt_free })} · {t('debt.totalInterest', { amount: formatMoney(plan.total_interest) })}
              </p>
              <p className="field-label">
                {t('debt.order')}: {plan.order.map(debtName).join(' → ')}
              </p>
              <DebtChart
                schedule={plan.schedule}
                monthsToDebtFree={plan.months_to_debt_free}
                formatMoney={formatMoney}
              />
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t('debt.name')}</th>
                      <th>{t('debt.payment')}</th>
                      <th>{t('debt.interest')}</th>
                      <th>{t('debt.balanceRemaining')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {firstMonthRows.map((row) => (
                      <tr key={row.debt_id}>
                        <td>{debtName(row.debt_id)}</td>
                        <td className="num">{formatMoney(row.payment)}</td>
                        <td className="num">{formatMoney(row.interest)}</td>
                        <td className="num">{formatMoney(row.remaining_balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
