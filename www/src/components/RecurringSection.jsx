import React from 'react';
import { useI18n } from '../i18n';
import { makeFormatMoney } from '../currency';
import CategoryBadge from './CategoryBadge';
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
 */
export default function RecurringSection({ currencySymbol, confirm, categories, recurring }) {
  const { t } = useI18n();
  const formatMoney = makeFormatMoney(currencySymbol);
  const { categoryFor, categoryName } = makeCategoryLookup(categories.items, t);

  const removeRecurring = async (item) => {
    const ok = await confirm(t('confirm.removeRecurring', { description: item.description }));
    if (ok) await recurring.remove(item.id);
  };

  return (
    <div className="panel">
      <h2>{t('recurring.title')}</h2>
      <p className="panel-subtitle">{t('recurring.hint')}</p>
      {recurring.items.length === 0 ? (
        <p className="empty-state">{t('recurring.none')}</p>
      ) : (
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
      )}
    </div>
  );
}
