import React from 'react';

// Same no-charting-library stance as DebtChart/SpendChart -- hand-rolled
// SVG arcs. The share each wedge draws comes from `budget_calc::category_shares`
// (arithmetic on money, so it lives in Rust); this only turns a fraction
// into `stroke-dasharray`/`stroke-dashoffset`, which is DOM geometry with
// no domain content of its own -- CLAUDE.md's own host-layer example.

const SIZE = 140;
const CENTER = SIZE / 2;
const RADIUS = 52;
const STROKE = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * `wedges`: `[{ id, share, color }]`, `share` in `[0, 1]` straight from
 * `category_shares` (already merged with each category's display color by
 * the caller, which owns `categoryVisuals.js` -- this component has no
 * opinion on what a category looks like, only on how to draw a ring).
 * Wedges with a zero share draw nothing rather than a zero-length arc.
 */
export default function DonutChart({ wedges, centerValue, centerLabel, ariaLabel }) {
  const slices = wedges.filter((w) => w.share > 0);
  if (slices.length === 0) return null;

  const arcs = slices.reduce((acc, w) => {
    const drawn = acc.length ? acc[acc.length - 1].drawn : 0;
    const length = w.share * CIRCUMFERENCE;
    acc.push({ ...w, length, dashoffset: -drawn * CIRCUMFERENCE, drawn: drawn + w.share });
    return acc;
  }, []);

  return (
    <div className="donut-chart">
      <svg className="donut-svg" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={ariaLabel}>
        <g fill="none" strokeWidth={STROKE} transform={`rotate(-90 ${CENTER} ${CENTER})`}>
          {arcs.map((a) => (
            <circle
              key={a.id}
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              stroke={a.color}
              strokeDasharray={`${a.length} ${CIRCUMFERENCE - a.length}`}
              strokeDashoffset={a.dashoffset}
            />
          ))}
        </g>
      </svg>
      <div className="donut-center">
        <span className="donut-total">{centerValue}</span>
        <span className="donut-cap">{centerLabel}</span>
      </div>
    </div>
  );
}
