import React, { useId } from 'react';
import { useI18n } from '../i18n';

// Hand-rolled SVG, same reasoning as mortgage_calculator's Charts.jsx: a
// charting library would cost more gzipped than the wasm module this app
// is built around.

const BLUE = '#4f8cff';
const AMBER = '#f59e0b';
const GRID = '#243044';

const W = 300;
const H = 140;
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
 * Total remaining balance (summed across every debt) declining to zero,
 * against cumulative interest paid, over the *entire* payoff schedule --
 * not just its first month. This is the chart the plan called for and the
 * build shipped without: the Rust engine already computes every month of
 * every debt, and the UI was only ever showing 1/25th of it.
 */
export default function DebtChart({ schedule, monthsToDebtFree, formatMoney }) {
  const { t } = useI18n();
  const gradientId = useId();
  if (!schedule?.length || !monthsToDebtFree) return null;

  // One point per debt per month; fold to one total-balance-per-month
  // series (and running interest) rather than plotting per-debt lines --
  // "when am I debt-free" is the question this answers, and a total is
  // legible where N overlapping per-debt lines would not be.
  const byMonth = new Map();
  for (const row of schedule) {
    const entry = byMonth.get(row.month) ?? { balance: 0, interest: 0 };
    entry.balance += row.remaining_balance;
    entry.interest += row.interest;
    byMonth.set(row.month, entry);
  }
  const months = Array.from(byMonth.keys()).sort((a, b) => a - b);

  const step = Math.max(1, Math.ceil(months.length / 120));
  const balances = [];
  const cumulativeInterest = [];
  let running = 0;
  months.forEach((m, i) => {
    running += byMonth.get(m).interest;
    if (i % step === 0 || i === months.length - 1) {
      balances.push(byMonth.get(m).balance);
      cumulativeInterest.push(running);
    }
  });

  const startingBalance = balances[0] ?? 0;
  const totalInterest = running;
  const max = Math.max(startingBalance, totalInterest, 1);

  return (
    <figure className="chart">
      <figcaption className="chart-title">{t('chart.debtTitle')}</figcaption>
      <div className="chart-legend">
        <span className="chart-key">
          <i style={{ background: BLUE }} /> {t('chart.remainingBalance')}
        </span>
        <span className="chart-key">
          <i style={{ background: AMBER }} /> {t('chart.interestToDate')}
        </span>
      </div>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t('chart.debtAria', {
          months: monthsToDebtFree,
          interest: formatMoney(totalInterest),
        })}
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
        <path d={pathFrom(balances, max, { close: true })} fill={`url(#${gradientId})`} />
        <path
          d={pathFrom(balances, max)}
          fill="none"
          stroke={BLUE}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={pathFrom(cumulativeInterest, max)}
          fill="none"
          stroke={AMBER}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="chart-axis">
        <span>{t('chart.monthN', { n: 0 })}</span>
        <span>{t('chart.monthN', { n: monthsToDebtFree })}</span>
      </div>
      <p className="chart-note">
        {t('chart.sharedScale', { min: formatMoney(0), max: formatMoney(max) })}
      </p>
    </figure>
  );
}
