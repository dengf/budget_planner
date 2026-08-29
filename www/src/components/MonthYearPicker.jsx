import React, { useState } from 'react';
import { useI18n } from '../i18n';
import { monthLabel, shiftMonth } from '../month';

/**
 * Month/year navigation shared by Dashboard, Budget and Transactions.
 *
 * The ‹ prev / label / next › row alone only steps one month at a time --
 * fine for browsing nearby months, painful for jumping a year or more.
 * Tapping the label opens a year stepper + month grid for a direct jump,
 * on top of the same one-tap adjacent-month stepping.
 */
export default function MonthYearPicker({ value, onChange, todayMonth, locale }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [gridYear, setGridYear] = useState(() => Number(value.split('-')[0]));

  const openPopup = () => {
    setGridYear(Number(value.split('-')[0]));
    setOpen(true);
  };

  const pick = (month) => {
    onChange(month);
    setOpen(false);
  };

  const monthNames = Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { month: 'short' }).format(new Date(2000, i, 1)),
  );

  return (
    <div className="dash-month-nav">
      <button
        type="button"
        className="dash-month-btn"
        aria-label={t('monthpicker.prevMonth')}
        onClick={() => onChange(shiftMonth(value, -1))}
      >
        ‹
      </button>
      <button type="button" className="dash-month-label monthpicker-trigger" onClick={openPopup}>
        {monthLabel(value, locale)}
      </button>
      <button
        type="button"
        className="dash-month-btn"
        aria-label={t('monthpicker.nextMonth')}
        onClick={() => onChange(shiftMonth(value, 1))}
      >
        ›
      </button>

      {open && (
        <div className="monthpicker-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="monthpicker-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t('monthpicker.choose')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="monthpicker-header">
              <span className="monthpicker-title">{t('monthpicker.choose')}</span>
              <button
                type="button"
                className="dash-month-btn"
                aria-label={t('monthpicker.close')}
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="monthpicker-year-row">
              <button
                type="button"
                className="dash-month-btn"
                aria-label={t('monthpicker.prevYear')}
                onClick={() => setGridYear((y) => y - 1)}
              >
                ‹
              </button>
              <span className="monthpicker-year-label">{gridYear}</span>
              <button
                type="button"
                className="dash-month-btn"
                aria-label={t('monthpicker.nextYear')}
                onClick={() => setGridYear((y) => y + 1)}
              >
                ›
              </button>
            </div>

            <div className="monthpicker-grid">
              {monthNames.map((name, i) => {
                const m = `${gridYear}-${String(i + 1).padStart(2, '0')}`;
                const isSelected = m === value;
                const isToday = m === todayMonth;
                return (
                  <button
                    type="button"
                    key={m}
                    className={`monthpicker-cell${isSelected ? ' active' : ''}${isToday ? ' today' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => pick(m)}
                  >
                    {name}
                  </button>
                );
              })}
            </div>

            <button type="button" className="btn secondary monthpicker-today-btn" onClick={() => pick(todayMonth)}>
              {t('monthpicker.jumpToday')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
