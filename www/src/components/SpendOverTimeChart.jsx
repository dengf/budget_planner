import React, { useId, useState } from 'react';
import { useI18n } from '../i18n';
import { dayLabel, weekLabel, weeksInMonth } from '../month';

// Hand-rolled SVG, same reasoning as DebtChart: a charting library would
// cost more gzipped than the wasm module this app is built around.

// No colour constants here on purpose. These used to be `#4f8cff`/`#f59e0b`
// (the pre-rebrand blue/amber) and `#243044` for the gridlines, hardcoded
// past the token system: the grid was a dark-theme value painted on a
// white card in light theme, and no chart in the app carried the brand at
// all. Colour now lives in main.css against `--accent` (the balance owed),
// `--gold` (what the borrowing costs) and `--line` (the grid) -- the same
// classes mortgage_calculator's charts use, since these three files are
// the same hand-rolled SVG.

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
 * without every day's own noise. Cumulative mode plots a running total
 * across the month instead -- the fix for a single large day (rent,
 * a big one-off) otherwise setting the y-axis and flattening every
 * other day near zero; a spike there just steepens the slope.
 *
 * `dailyTotals`/`weeklyTotals` (settled recurring bills already dropped)
 * and `dailyTotalsIncludingRecurring`/`weeklyTotalsIncludingRecurring`
 * (the same transactions, nothing dropped): `[{ date, amount }]` from two
 * passes of `wasm.daily_spend`/`wasm.weekly_spend`, one over each
 * transaction list the caller built via `wasm.recurring_status`. Kept as
 * two ready-made series rather than one plus a client-side re-derivation,
 * so flipping "Include recurring bills" is instant with no wasm round
 * trip. `excludesRecurring`: whether there was anything to drop this
 * month at all -- gates whether the toggle renders; with nothing settled
 * this round, the two series are identical and the toggle would change
 * nothing. `daysInMonth`: from `month.js`, the host-layer calendar
 * arithmetic this chart needs to build a full x-axis -- budget-calc has
 * no reason to know how many days are in a month.
 *
 * The toggle defaults off (recurring excluded) -- a settled bill is
 * already accounted for elsewhere in the budget, not "unusual spending".
 * The "anything to show" gate always reads the *including* series
 * regardless of the toggle's position, so a month whose only transaction
 * was a settled bill still shows the chart (and the toggle to reveal it)
 * rather than looking like an empty month. Switching daily/weekly/
 * cumulative never itself makes the chart appear or disappear, since all
 * three read from the same two underlying series.
 */
export default function SpendOverTimeChart({
  dailyTotals,
  weeklyTotals,
  dailyTotalsIncludingRecurring,
  weeklyTotalsIncludingRecurring,
  excludesRecurring,
  month,
  daysInMonth: dayCount,
  formatMoney,
  locale,
}) {
  const { t } = useI18n();
  const gradientId = useId();
  const [granularity, setGranularity] = useState('daily');
  // Off by default: a settled recurring bill is already accounted for
  // elsewhere in the budget, so the quieter default hides it here too.
  // The toggle only ever renders when `excludesRecurring` says there is
  // something for it to reveal.
  const [includeRecurring, setIncludeRecurring] = useState(false);

  const buildDailyValues = (totals) => {
    const byDay = new Map((totals ?? []).map((row) => [row.date, row.amount]));
    return Array.from({ length: dayCount }, (_, i) => {
      const day = String(i + 1).padStart(2, '0');
      return byDay.get(`${month}-${day}`) ?? 0;
    });
  };
  const dailyValuesExcluding = buildDailyValues(dailyTotals);
  const dailyValuesIncluding = buildDailyValues(dailyTotalsIncludingRecurring ?? dailyTotals);
  // The "anything to show" gate reads the *including* total, not
  // whichever the toggle currently has selected -- a month whose only
  // spending was a settled recurring bill would otherwise sum to zero on
  // the excluding-by-default view and hide the chart (and the toggle to
  // reveal it) entirely.
  const totalIncluding = dailyValuesIncluding.reduce((sum, v) => sum + v, 0);
  if (totalIncluding <= 0) return null;

  const weeks = weeksInMonth(month);
  const buildWeeklyValues = (totals) => {
    const byWeek = new Map((totals ?? []).map((row) => [row.date, row.amount]));
    return weeks.map((w) => byWeek.get(w.start) ?? 0);
  };
  const weeklyValuesExcluding = buildWeeklyValues(weeklyTotals);
  const weeklyValuesIncluding = buildWeeklyValues(weeklyTotalsIncludingRecurring ?? weeklyTotals);

  const dailyValues = includeRecurring ? dailyValuesIncluding : dailyValuesExcluding;
  const weeklyValues = includeRecurring ? weeklyValuesIncluding : weeklyValuesExcluding;
  const total = dailyValues.reduce((sum, v) => sum + v, 0);

  // A running total over the same per-day series `dailyValues` already
  // builds. Monotonically non-decreasing, so `Math.max` below is always
  // its last entry -- a single large recurring payment (excluded by
  // default) no longer needs special-casing here the way it would on the
  // daily/weekly views, since a spike just steepens the slope instead of
  // dominating the y-axis.
  const cumulativeValues = dailyValues.reduce((acc, v) => {
    acc.push((acc.at(-1) ?? 0) + v);
    return acc;
  }, []);

  const values =
    granularity === 'weekly'
      ? weeklyValues
      : granularity === 'cumulative'
        ? cumulativeValues
        : dailyValues;
  const max = Math.max(...values, 1);
  // The first index reaching the max: for daily/weekly this is the
  // biggest single bucket, same as before. For cumulative (monotonic) it
  // is the day the running total stopped climbing -- the day spending for
  // the month effectively finished, which is a more informative "day" to
  // report than the calendar's last day.
  const peakIndex = values.indexOf(Math.max(...values));

  const titleKey = {
    weekly: 'chart.weeklySpendTitle',
    cumulative: 'chart.cumulativeSpendTitle',
    daily: 'chart.dailySpendTitle',
  }[granularity];

  // Only claim "not counting recurring bills" while that's actually true
  // of the figures on screen -- once the toggle is switched on, this view
  // is showing the same total a caller with no recurring configured at
  // all would see, and the qualifier would be a false disclaimer.
  const showingExcluded = excludesRecurring && !includeRecurring;
  const totalKey = {
    weekly: showingExcluded ? 'chart.weeklySpendTotalExcludingRecurring' : 'chart.weeklySpendTotal',
    cumulative: showingExcluded
      ? 'chart.cumulativeSpendTotalExcludingRecurring'
      : 'chart.cumulativeSpendTotal',
    daily: showingExcluded ? 'chart.dailySpendTotalExcludingRecurring' : 'chart.dailySpendTotal',
  }[granularity];

  const ariaLabel =
    granularity === 'weekly'
      ? t('chart.weeklySpendAria', {
          amount: formatMoney(total),
          week: weekLabel(weeks[peakIndex].start, weeks[peakIndex].end, locale),
        })
      : granularity === 'cumulative'
        ? t('chart.cumulativeSpendAria', { amount: formatMoney(total), day: peakIndex + 1 })
        : t('chart.dailySpendAria', { amount: formatMoney(total), day: peakIndex + 1 });

  return (
    <figure className="chart">
      <div className="chart-header">
        <figcaption className="chart-title">{t(titleKey)}</figcaption>
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
          <button
            type="button"
            className={granularity === 'cumulative' ? 'app-region active' : 'app-region'}
            aria-pressed={granularity === 'cumulative'}
            onClick={() => setGranularity('cumulative')}
          >
            {t('chart.granularityCumulative')}
          </button>
        </div>
      </div>
      {excludesRecurring && (
        <label className="field field-check chart-recurring-toggle">
          <input
            type="checkbox"
            checked={includeRecurring}
            onChange={(e) => setIncludeRecurring(e.target.checked)}
          />
          <span>{t('chart.includeRecurringToggle')}</span>
        </label>
      )}
      <svg
        className="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop className="chart-area-from" offset="0%" />
            <stop className="chart-area-to" offset="100%" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            className="chart-grid-line"
            x1={PAD_L}
            x2={W - PAD_R}
            y1={PAD_T + (H - PAD_T - PAD_B) * f}
            y2={PAD_T + (H - PAD_T - PAD_B) * f}
          />
        ))}
        <path d={pathFrom(values, max, { close: true })} fill={`url(#${gradientId})`} />
        <path
          className="chart-line chart-line-balance"
          d={pathFrom(values, max)}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="chart-axis">
        {granularity === 'weekly' ? (
          <>
            <span>{weekLabel(weeks[0].start, weeks[0].end, locale)}</span>
            <span>{weekLabel(weeks.at(-1).start, weeks.at(-1).end, locale)}</span>
          </>
        ) : (
          <>
            <span>{dayLabel(month, 1, locale)}</span>
            <span>{dayLabel(month, dayCount, locale)}</span>
          </>
        )}
      </div>
      <p className="chart-note">{t(totalKey, { amount: formatMoney(total) })}</p>
    </figure>
  );
}
