import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { makeFormatMoney } from '../currency';
import { todayIso } from '../month';
import NumberField from './NumberField';
import CalcError from './CalcError';
import DebtChart from './DebtChart';

export default function DebtTab({
  wasmModule,
  currencySymbol,
  newId,
  confirm,
  debts,
  transactions,
}) {
  const { t } = useI18n();
  const formatMoney = makeFormatMoney(currencySymbol);
  const [draft, setDraft] = useState({ name: '', balance: '', apr_percent: '', min_payment: '' });
  const [extraPayment, setExtraPayment] = useState(0);
  const [strategy, setStrategy] = useState('snowball');
  const [plan, setPlan] = useState(null);
  // Which debt's payment form is open, the amount typed into it, and
  // what the last recorded payment did. One at a time: two open forms on
  // a 375px screen is two ways to lose track of which row you are on.
  const [payingId, setPayingId] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [outcome, setOutcome] = useState(null);
  const [paymentError, setPaymentError] = useState(null);

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

  const openPayment = async (debt) => {
    setOutcome(null);
    setPaymentError(null);
    if (payingId === debt.id) {
      setPayingId(null);
      return;
    }
    setPayingId(debt.id);
    // Pre-filled with the minimum payment, since that is the number
    // someone recording a payment is most often recording. Typed over
    // freely -- it is a starting point, not a constraint.
    setPaymentAmount(String(debt.min_payment ?? ''));
  };

  /**
   * Record a payment: log the transaction, then write the new balance.
   *
   * Both halves, or the payoff chart goes on projecting from a balance
   * that stopped being true -- the original debt-free date, stated with
   * full confidence, months after it stopped being reachable. Every
   * figure here comes from `record_debt_payment`, which runs the same
   * month-step the projection itself runs, so a recorded payment and the
   * plan's first month can never disagree about what it achieved.
   */
  const recordPayment = async (debt, e) => {
    e.preventDefault();
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (!wasmModule?.record_debt_payment || !wasmModule?.signed_amount) return;

    const applied = await wasmModule.record_debt_payment({ debt, payment: amount });
    if (applied?.error) {
      setPaymentError(applied);
      return;
    }
    const signed = await wasmModule.signed_amount({ magnitude: amount, is_income: false });
    if (signed?.error) {
      setPaymentError(signed);
      return;
    }

    await transactions.save({
      id: newId(),
      date: todayIso(),
      description: t('debt.paymentDescription', { name: debt.name }),
      amount: signed.amount,
      category_id: null,
    });
    await debts.save({ ...debt, balance: applied.new_balance });

    setPaymentError(null);
    setPayingId(null);
    setPaymentAmount('');
    setOutcome({ ...applied, name: debt.name });
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
                <React.Fragment key={d.id}>
                  <tr>
                    <td>{d.name}</td>
                    <td className="num">{formatMoney(d.balance)}</td>
                    <td className="num">{d.apr_percent.toFixed(2)}%</td>
                    <td className="num">{formatMoney(d.min_payment)}</td>
                    <td className="debt-row-actions">
                      <button
                        className="btn secondary"
                        aria-expanded={payingId === d.id}
                        onClick={() => openPayment(d)}
                      >
                        {t('debt.recordPayment')}
                      </button>
                      <button className="btn ghost" onClick={() => removeDebt(d)}>
                        {t('budget.remove')}
                      </button>
                    </td>
                  </tr>
                  {payingId === d.id && (
                    <tr className="debt-payment-row">
                      <td colSpan={5}>
                        <form className="debt-payment-form" onSubmit={(e) => recordPayment(d, e)}>
                          <NumberField
                            label={t('debt.paymentAmount', { name: d.name })}
                            value={paymentAmount}
                            onChange={setPaymentAmount}
                            grouped
                          />
                          <button className="btn" type="submit">
                            {t('debt.recordPaymentCta')}
                          </button>
                        </form>
                        <p className="debt-payment-hint">{t('debt.recordPaymentHint')}</p>
                        {paymentError && <CalcError result={paymentError} />}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {outcome && (
        <p className="debt-payment-outcome" role="status">
          {outcome.paid_off
            ? t('debt.paymentPaidOff', { name: outcome.name })
            : t('debt.paymentApplied', {
                name: outcome.name,
                principal: formatMoney(outcome.principal),
                interest: formatMoney(outcome.interest),
                balance: formatMoney(outcome.new_balance),
              })}
          {/* A payment smaller than the month's interest leaves the
              balance higher than it started. Saying so is the whole
              point of recording it -- the chart would otherwise just
              redraw a little further out with no explanation. */}
          {!outcome.covers_interest && ' ' + t('debt.paymentUnderInterest')}
          {outcome.overpaid > 0 &&
            ' ' + t('debt.paymentOverpaid', { amount: formatMoney(outcome.overpaid) })}
        </p>
      )}

      <form className="form-grid" onSubmit={addDebt}>
        <label className="field">
          <span className="field-label">{t('debt.name')}</span>
          <div className="field-input">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
        </label>
        <NumberField
          label={t('debt.balance')}
          value={draft.balance}
          onChange={(v) => setDraft({ ...draft, balance: v })}
          grouped
        />
        <NumberField
          label={t('debt.apr')}
          value={draft.apr_percent}
          onChange={(v) => setDraft({ ...draft, apr_percent: v })}
          suffix="%"
        />
        <NumberField
          label={t('debt.minPayment')}
          value={draft.min_payment}
          onChange={(v) => setDraft({ ...draft, min_payment: v })}
          grouped
        />
        <button className="btn" type="submit">
          {t('debt.add')}
        </button>
      </form>

      {debts.items.length > 0 && (
        <>
          <div className="form-grid">
            <NumberField
              label={t('debt.extraPayment')}
              value={extraPayment}
              onChange={setExtraPayment}
              grouped
            />
            <label className="field">
              <span className="field-label">{t('debt.strategy')}</span>
              <select
                className="field-select"
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
              >
                <option value="snowball">{t('debt.snowball')}</option>
                <option value="avalanche">{t('debt.avalanche')}</option>
              </select>
            </label>
          </div>

          {plan?.error && <CalcError result={plan} />}

          {plan && !plan.error && (
            <>
              <div className="debt-hero">
                <span className="debt-hero-headline">
                  {t('debt.monthsToDebtFree', { months: plan.months_to_debt_free })}
                </span>
                <span className="debt-hero-sub">
                  {t('debt.totalInterest', { amount: formatMoney(plan.total_interest) })}
                </span>
              </div>
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
