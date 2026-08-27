import React from 'react';
import { useI18n } from '../i18n';
import { directionMismatch } from '../directionMismatch';

/**
 * Fires when a typed amount's sign disagrees with the picked category's
 * own income/expense direction -- see `directionMismatch.js` for why this
 * is a real "vanishes from every report" bug, not just an odd entry.
 *
 * `onUseFlipped` sets the draft's amount to the sign-corrected value; the
 * warning stays a suggestion, not a block, since a genuine refund against
 * an expense category (or a rare negative income adjustment) is real data,
 * not a mistake.
 */
export default function DirectionWarning({ amount, category, formatMoney, onUseFlipped }) {
  const { t } = useI18n();
  if (!category || !directionMismatch(amount, category.is_income)) return null;

  const flipped = -Number(amount);
  const flippedText = formatMoney(flipped);
  const key = category.is_income ? 'transactions.directionMismatchIncome' : 'transactions.directionMismatchExpense';

  return (
    <p className="direction-warning" role="alert">
      {t(key, { category: category.name, flipped: flippedText })}{' '}
      <button type="button" className="btn ghost" onClick={() => onUseFlipped(flipped)}>
        {t('transactions.useFlippedAmount', { flipped: flippedText })}
      </button>
    </p>
  );
}
