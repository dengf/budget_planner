import React, { useState } from 'react';
import { useI18n } from '../i18n';
import CategoryBadge from './CategoryBadge';

/**
 * The bottom-anchored, thumb-reachable way to log a transaction once a
 * month is fully assigned -- this repo's mobile-first rule says the
 * action someone reaches for most belongs where a thumb can hit it
 * without a grip shift, and relying on a small per-row "+" as the only
 * entry point doesn't satisfy that.
 *
 * Doesn't duplicate the existing per-row quick-add form: picking a
 * category here just reports which id was picked, and the caller
 * (`BudgetTab`) opens that row's existing inline form and scrolls to it,
 * the same `openSpend` state machine the per-row "+" already drives.
 */
export default function QuickAddFab({ categories, onPick }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);

  if (categories.length === 0) return null;

  const sorted = [...categories].sort((a, b) => a.name.localeCompare(b.name, locale));

  return (
    <>
      {open && (
        <div className="fab-picker" role="menu">
          {sorted.map((category) => (
            <button
              key={category.id}
              type="button"
              role="menuitem"
              className="fab-picker-item"
              onClick={() => {
                setOpen(false);
                onPick(category.id);
              }}
            >
              <CategoryBadge category={category} />
              {category.name}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="fab-add"
        aria-expanded={open}
        aria-label={t('budget.logTransaction')}
        onClick={() => setOpen((o) => !o)}
      >
        +
      </button>
    </>
  );
}
