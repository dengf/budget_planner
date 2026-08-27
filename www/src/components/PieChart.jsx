import React from 'react';

// Hand-rolled SVG, same reasoning as SpendChart/DebtChart: a charting
// library would cost more gzipped than the wasm module this app is
// built around.

const SIZE = 160;
const R = 70;
const CX = SIZE / 2;
const CY = SIZE / 2;

// A fixed categorical palette rather than generated colors: stable
// across renders (the same category is always the same color from one
// month's report to the next) and picked to hold up on both this app's
// dark screen background and the white page `window.print()` produces --
// SpendChart/DebtChart only ever render on screen, so this is the first
// chart that has to work in both.
const PALETTE = [
  '#4f8cff',
  '#f59e0b',
  '#22c55e',
  '#ef4444',
  '#a855f7',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#64748b',
];

function pointOnCircle(angle) {
  return [CX + R * Math.sin(angle), CY - R * Math.cos(angle)];
}

function wedgePath(startAngle, endAngle) {
  const [x1, y1] = pointOnCircle(startAngle);
  const [x2, y2] = pointOnCircle(endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M${CX},${CY} L${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${largeArc},1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`;
}

/**
 * A breakdown by category as wedges of a circle, sized by share of the
 * total. `items`: `[{ id, label, value }]`, already filtered to the
 * positive values that belong in this chart -- an income breakdown and
 * an expense breakdown are two separate instances of this component
 * with two different filtered lists, not one chart trying to show both
 * directions of money at once.
 *
 * Renders nothing on a total of zero rather than an empty ring, same as
 * SpendChart returning `null` on no spending -- a chart with nothing to
 * show is not a chart, it's a shape.
 */
export default function PieChart({ title, items, formatMoney, ariaLabel }) {
  const total = items.reduce((sum, i) => sum + i.value, 0);
  if (total <= 0) return null;

  const sorted = [...items].sort((a, b) => b.value - a.value);

  let angle = 0;
  const wedges = sorted.map((item, index) => {
    const sweep = (item.value / total) * Math.PI * 2;
    // A single category holding the whole total has startAngle ===
    // endAngle after a full loop, which draws a degenerate (invisible)
    // wedge -- a plain circle is the correct rendering of "100%", not an
    // edge case to special-case away.
    const isFullCircle = sweep >= Math.PI * 2 - 1e-6;
    const path = isFullCircle ? null : wedgePath(angle, angle + sweep);
    angle += sweep;
    return { ...item, path, color: PALETTE[index % PALETTE.length] };
  });

  return (
    <figure className="chart pie-chart">
      <figcaption className="chart-title">{title}</figcaption>
      <div className="pie-chart-body">
        <svg className="pie-svg" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={ariaLabel}>
          {wedges.map((w) =>
            w.path ? (
              <path key={w.id} d={w.path} fill={w.color} />
            ) : (
              <circle key={w.id} cx={CX} cy={CY} r={R} fill={w.color} />
            ),
          )}
        </svg>
        <ul className="pie-legend">
          {wedges.map((w) => (
            <li key={w.id}>
              <i style={{ background: w.color }} />
              <span className="pie-legend-label">{w.label}</span>
              <span className="pie-legend-value">{formatMoney(w.value)}</span>
              <span className="pie-legend-pct">{Math.round((w.value / total) * 100)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}
