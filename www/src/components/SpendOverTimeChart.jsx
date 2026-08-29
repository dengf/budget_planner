import React, { useId, useState } from 'react';
import { useI18n } from '../i18n';
import { weekLabel, weeksInMonth } from '../month';

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
 * Spending across the selected month, so a reader can see *when* the
 * money went rather than only the category totals the table and pie
 * chart already show. Daily mode plots every day, not just days with a
 * transaction -- a gap in spending is real information (a quiet week),
 * and skipping straight from day 3 to day 19 would draw a slope that
 * implies gradual spending that never happened. Weekly mode is the same
 * idea one level up, for a reader who wants the shape of the month
 * without every day's own noise.
 *
 * `dailyTotals`/`weeklyTotals`: `[{ date, amount }]` from
 * `wasm.daily_spend`/`wasm.weekly_spend`, already the positive spend
 * side. `daysInMonth`: from `month.js`, the host-layer calendar
 * arithmetic this chart needs to build a full x-axis -- budget-calc has
 * no reason to know how many days are in a month.
 *
 * The "anything to show" gate is always read from `dailyTotals`
 * regardless of which mode is active -- both totals are derived from the
 * same transactions and sum to the same figure, so tying the gate to one
 * source of truth means switching the toggle never itself makes the
 * chart appear or disappear.
 */
export default function SpendOverTimeChart({ dailyTotals, weeklyTotals, month, daysInMonth: dayCount, formatMoney, locale }) {
  const { t } = useI18n();
  const gradientId = useId();
  const [granularity, setGranularity] = useState('daily');

  const byDay = new Map((dailyTotals ?? []).map((row) => [row.date, row.amount]));
  const dailyValues = Array.from({ length: dayCount }, (_, i) => {
    const day = String(i + 1).padStart(2, '0');
    return byDay.get(`${month}-${day}`) ?? 0;
  });
  const total = dailyValues.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return null;

  const weeks = weeksInMonth(month);
  const byWeek = new Map((weeklyTotals ?? []).map((row) => [row.date, row.amount]));
  const weeklyValues = weeks.map((w) => byWeek.get(w.start) ?? 0);

  const values = granularity === 'weekly' ? weeklyValues : dailyValues;
  const max = Math.max(...values, 1);
  const peakIndex = values.indexOf(Math.max(...values));

  const ariaLabel =
    granularity === 'weekly'
      ? t('chart.weeklySpendAria', { amount: formatMoney(total), week: weekLabel(weeks[peakIndex].start, weeks[peakIndex].end, locale) })
      : t('chart.dailySpendAria', { amount: formatMoney(total), day: peakIndex + 1 });

  return (
    <figure className="chart">
      <div className="chart-header">
        <figcaption className="chart-title">
          {t(granularity === 'weekly' ? 'chart.weeklySpendTitle' : 'chart.dailySpendTitle')}
        </figcaption>
        <div className="chart-granularity" role="group" aria-label={t('chart.granularityGroup')}>
          <button
            type="button"
            className={granularity === 'daily' ? 'app-region active' : 'app-region'}
            aria-pressed={granularity === 'daily'}
            onClick={() => setGranularity('daily')}
          >
            {t('chart.granularityDaily')}
          </button>
          <button
            type="button"
            className={granularity === 'weekly' ? 'app-region active' : 'app-region'}
            aria-pressed={granularity === 'weekly'}
            onClick={() => setGranularity('weekly')}
          >
            {t('chart.granularityWeekly')}
          </button>
        </div>
      </div>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
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
        {granularity === 'weekly' ? (
          <>
            <span>{weekLabel(weeks[0].start, weeks[0].end, locale)}</span>
            <span>{weekLabel(weeks.at(-1).start, weeks.at(-1).end, locale)}</span>
          </>
        ) : (
          <>
            <span>{t('chart.dayN', { n: 1 })}</span>
            <span>{t('chart.dayN', { n: dayCount })}</span>
          </>
        )}
      </div>
      <p className="chart-note">
        {t(granularity === 'weekly' ? 'chart.weeklySpendTotal' : 'chart.dailySpendTotal', { amount: formatMoney(total) })}
      </p>
    </figure>
  );
}
