import React from 'react';
import { useI18n } from '../i18n';

/**
 * Where the month's money actually went, biggest first, with each
 * category's planned amount marked on its bar.
 *
 * Reads spending at a glance in a way a column of numbers doesn't: which
 * categories dominate, and which ones crossed their line. The planned
 * marker is the point -- a long bar is only bad relative to its plan, and
 * showing spend alone would make rent look like a problem every month.
 *
 * Plain elements rather than SVG: these are axis-aligned rectangles that
 * need to wrap and reflow with their labels, which CSS does better than a
 * fixed viewBox. Same no-charting-library stance as DebtChart either way.
 *
 * Every figure here is already computed by `budget-calc::build_month`;
 * this only turns them into geometry, which CLAUDE.md places in the host
 * layer alongside formatting.
 */
export default function SpendChart({ lines, categoryName, formatMoney }) {
  const { t } = useI18n();

  const spending = (lines ?? []).filter((l) => l.spent > 0).sort((a, b) => b.spent - a.spent);
  if (spending.length === 0) return null;

  // One scale across every bar, so bar lengths are comparable to each
  // other -- the whole point of putting them in a column. Planned is in
  // the max so a marker never falls off the end of its own track.
  const max = Math.max(...spending.map((l) => Math.max(l.spent, l.planned)), 1);
  const total = spending.reduce((sum, l) => sum + l.spent, 0);

  return (
    <figure className="chart spend-chart">
      <figcaption className="chart-title">{t('chart.spendTitle')}</figcaption>
      <div className="chart-legend">
        <span className="chart-key"><i className="key-spent" /> {t('budget.spent')}</span>
        <span className="chart-key"><i className="key-planned" /> {t('budget.planned')}</span>
      </div>

      <div className="spend-rows">
        {spending.map((line) => {
          const spentPct = (line.spent / max) * 100;
          const plannedPct = (line.planned / max) * 100;
          const over = line.planned > 0 && line.spent > line.planned;
          return (
            <div className="spend-row" key={line.category_id}>
              <span className="spend-name">{categoryName(line.category_id)}</span>
              <span
                className="spend-track"
                role="img"
                aria-label={t('chart.spendRowAria', {
                  name: categoryName(line.category_id),
                  spent: formatMoney(line.spent),
                  planned: formatMoney(line.planned),
                })}
              >
                <span
                  className={over ? 'spend-bar over' : 'spend-bar'}
                  style={{ width: `${spentPct.toFixed(2)}%` }}
                />
                {line.planned > 0 && (
                  <span className="spend-marker" style={{ left: `${plannedPct.toFixed(2)}%` }} />
                )}
              </span>
              <span className={over ? 'spend-figure over' : 'spend-figure'}>{formatMoney(line.spent)}</span>
            </div>
          );
        })}
      </div>

      <p className="chart-note">{t('chart.spendTotal', { amount: formatMoney(total) })}</p>
    </figure>
  );
}
