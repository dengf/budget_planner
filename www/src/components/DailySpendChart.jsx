import React, { useId } from 'react';
import { useI18n } from '../i18n';

// Hand-rolled SVG, same reasoning as DebtChart/PieChart: a charting
// library would cost more gzipped than the wasm module this app is built
// around.

const BLUE = '#4f8cff';
const GRID = '#243044';

const W = 300;
const H = 120;
const PAD_L = 4;
const PAD_R = 4;
const PAD_T = 6;
const PAD_B = 6;

function pathFrom(values, max, { close = false } = {}) {
  if (!values.length || max <= 0) return '';
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const x = (i) => PAD_L + (innerW * i) / Math.max(1, values.length - 1);
  const y = (v) => PAD_T + innerH * (1 - Math.min(1, Math.max(0, v / max)));

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`);
  if (!close) return line.join(' ');
  return `${line.join(' ')} L${x(values.length - 1).toFixed(2)},${(H - PAD_B).toFixed(2)} L${x(0).toFixed(2)},${(H - PAD_B).toFixed(2)} Z`;
}

/**
 * Day-by-day spending across the selected month, so a reader can see
 * *when* the money went rather than only the category totals the table
 * and pie chart already show. Every day of the month is plotted, not just
 * days with a transaction -- a gap in spending is real information (a
 * quiet week), and skipping straight from day 3 to day 19 would draw a
 * slope that implies gradual spending that never happened.
 *
 * `totals`: `[{ date: 'YYYY-MM-DD', amount }]` from `wasm.daily_spend`,
 * already the positive spend side. `daysInMonth`: from `month.js`, the
 * host-layer calendar arithmetic this chart needs to build a full x-axis
 * -- budget-calc has no reason to know how many days are in a month.
 */
export default function DailySpendChart({ totals, month, daysInMonth: dayCount, formatMoney }) {
  const { t } = useI18n();
  const gradientId = useId();

  const byDay = new Map((totals ?? []).map((row) => [row.date, row.amount]));
  const values = Array.from({ length: dayCount }, (_, i) => {
    const day = String(i + 1).padStart(2, '0');
    return byDay.get(`${month}-${day}`) ?? 0;
  });

  const total = values.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return null;

  const max = Math.max(...values, 1);
  const peakDay = values.indexOf(Math.max(...values)) + 1;

  return (
    <figure className="chart">
      <figcaption className="chart-title">{t('chart.dailySpendTitle')}</figcaption>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t('chart.dailySpendAria', { amount: formatMoney(total), day: peakDay })}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BLUE} stopOpacity="0.28" />
            <stop offset="100%" stopColor={BLUE} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={PAD_L}
            x2={W - PAD_R}
            y1={PAD_T + (H - PAD_T - PAD_B) * f}
            y2={PAD_T + (H - PAD_T - PAD_B) * f}
            stroke={GRID}
            strokeWidth="0.5"
          />
        ))}
        <path d={pathFrom(values, max, { close: true })} fill={`url(#${gradientId})`} />
        <path d={pathFrom(values, max)} fill="none" stroke={BLUE} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chart-axis">
        <span>{t('chart.dayN', { n: 1 })}</span>
        <span>{t('chart.dayN', { n: dayCount })}</span>
      </div>
      <p className="chart-note">{t('chart.dailySpendTotal', { amount: formatMoney(total) })}</p>
    </figure>
  );
}
