import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { makeFormatMoney } from '../currency';
import { monthLabel } from '../month';
import CategoryBadge from './CategoryBadge';
import CalcError from './CalcError';
import { makeCategoryLookup } from '../presetCategories';

/**
 * Recurring expenses -- rent, subscriptions, anything on a schedule.
 *
 * Lifted out of the Transactions tab for the same reason as the rules
 * table beside it: this is something set up once and then watched, not
 * something touched on the way past. New ones are still created in the
 * Add sheet's own Recurring tab, behind the nav bar's "+", which is
 * where every other kind of record starts; this screen is the list of
 * what exists, and the way to remove one.
 *
 * It is also where a schedule meets the transactions that should have
 * been settling it. A recurring expense used to be a standing
 * declaration and nothing more -- it said rent was due on the 1st and
 * never once looked at whether rent had been paid. The "this month"
 * list below closes that loop: `recurring_status` matches each
 * occurrence against the month's real transactions, and anything still
 * unmatched gets a one-tap "mark as paid" that writes the transaction
 * `occurrence_payment` describes. Neither the matching rule nor the
 * transaction's own shape is decided here -- see
 * `budget_calc::match_occurrences` and `payment_for_occurrence`.
 */
export default function RecurringSection({
  wasmModule,
  currencySymbol,
  confirm,
  categories,
  recurring,
  transactions,
  viewMonth,
  newId,
}) {
  const { t, locale } = useI18n();
  const formatMoney = makeFormatMoney(currencySymbol);
  const { categoryFor, categoryName } = makeCategoryLookup(categories.items, t);
  const [status, setStatus] = useState(null);
  const [payError, setPayError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!wasmModule?.recurring_status || recurring.items.length === 0) {
        if (!cancelled) setStatus(null);
        return;
      }
      const result = await wasmModule.recurring_status({
        recurring: recurring.items,
        transactions: transactions.items.filter((tx) => tx.date?.startsWith(viewMonth)),
        month: viewMonth,
      });
      if (!cancelled) setStatus(result?.error ? null : result);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [wasmModule, recurring.items, transactions.items, viewMonth]);

  const removeRecurring = async (item) => {
    const ok = await confirm(t('confirm.removeRecurring', { description: item.description }));
    if (ok) await recurring.remove(item.id);
  };

  // The date, the description, the sign and the category all come back
  // from `occurrence_payment`, so the row this writes is by construction
  // one the next `recurring_status` pass recognises as settling the
  // occurrence it came from.
  const markPaid = async (occurrence) => {
    if (!wasmModule?.occurrence_payment) return;
    const payment = await wasmModule.occurrence_payment({ occurrence });
    if (payment?.error) {
      setPayError(payment);
      return;
    }
    setPayError(null);
    await transactions.save({
      id: newId(),
      date: payment.date,
      description: payment.description,
      amount: payment.amount,
      category_id: payment.category_id,
    });
  };

  return (
    <div className="panel">
      <h2>{t('recurring.title')}</h2>
      <p className="panel-subtitle">{t('recurring.hint')}</p>

      {status && status.statuses.length > 0 && (
        <>
          <h2 className="section-start">
            {t('recurring.thisMonthTitle', { month: monthLabel(viewMonth, locale) })}
          </h2>
          <p className="panel-subtitle">
            {status.unpaid_count === 0
              ? t('recurring.allPaid')
              : t('recurring.stillDue', {
                  count: status.unpaid_count,
                  amount: formatMoney(status.unpaid_total),
                })}
          </p>
          {payError && <CalcError result={payError} />}
          <ul className="recurring-status-list">
            {status.statuses.map((s) => (
              <li
                key={`${s.occurrence.recurring_id}-${s.occurrence.date}`}
                className={s.paid ? 'recurring-status paid' : 'recurring-status due'}
              >
                <span className="recurring-status-date">{s.occurrence.date}</span>
                <span className="recurring-status-body">
                  <span className="recurring-status-desc">{s.occurrence.description}</span>
                  <span className="recurring-status-meta">
                    {formatMoney(s.occurrence.amount)} &middot;{' '}
                    {categoryName(s.occurrence.category_id)}
                  </span>
                </span>
                {s.paid ? (
                  <span className="recurring-status-tag">{t('recurring.paid')}</span>
                ) : (
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => markPaid(s.occurrence)}
                  >
                    {t('recurring.markPaid')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {recurring.items.length === 0 ? (
        <p className="empty-state">{t('recurring.none')}</p>
      ) : (
        <>
          <h2 className="section-start">{t('recurring.scheduleTitle')}</h2>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('recurring.description')}</th>
                  <th>{t('transactions.category')}</th>
                  <th>{t('budget.planned')}</th>
                  <th>{t('recurring.cadence')}</th>
                  <th>{t('recurring.anchorDate')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recurring.items.map((r) => (
                  <tr key={r.id}>
                    <td>{r.description}</td>
                    <td>
                      <span className="category-cell">
                        <CategoryBadge category={categoryFor(r.category_id)} />
                        {categoryName(r.category_id)}
                      </span>
                    </td>
                    <td className="num">{formatMoney(r.amount)}</td>
                    <td>{t(`freq.${r.cadence}`)}</td>
                    <td>{r.anchor_date}</td>
                    <td>
                      <button className="btn ghost" onClick={() => removeRecurring(r)}>
                        {t('budget.remove')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
