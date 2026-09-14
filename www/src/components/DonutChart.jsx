import React from 'react';
import CategoryBadge from './CategoryBadge';

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

// Room around the ring for the plan artifact's own callout bubbles
// (`.p-bub`/`.p-leaders`) -- a percentage-and-icon badge floating near
// each wedge with a short leader line back to it, not just a bare ring.
// `BUBBLE_COUNT` caps which wedges get one: the plan's own examples show
// one per wedge (two, then five), but a household with a dozen categories
// would crowd the ring past readability, so this stops at the largest
// five -- the ranked rows below still name every category regardless.
const CONTAINER_W = 236;
const CONTAINER_H = 200;
const OFFSET_X = (CONTAINER_W - SIZE) / 2;
const OFFSET_Y = (CONTAINER_H - SIZE) / 2;
const RING_CENTER_X = OFFSET_X + CENTER;
const RING_CENTER_Y = OFFSET_Y + CENTER;
const RING_OUTER = RADIUS + STROKE / 2;
const BUBBLE_DIST = RING_OUTER + 10;
const BUBBLE_COUNT = 5;

// `fraction` is a point on the ring in [0, 1), clockwise from 12 o'clock
// -- the same convention the arc-drawing `rotate(-90 ...)` below uses --
// `dist` is how far out from the ring center to place the point.
function pointOnRing(fraction, dist) {
  const theta = fraction * 2 * Math.PI;
  return {
    x: RING_CENTER_X + dist * Math.sin(theta),
    y: RING_CENTER_Y - dist * Math.cos(theta),
  };
}

/**
 * `wedges`: `[{ id, share, color, category }]`, `share` in `[0, 1]`
 * straight from `category_shares` (already merged with each category's
 * display color and its own record by the caller, which owns
 * `categoryVisuals.js` -- this component has no opinion on what a
 * category looks like, only on how to draw a ring and place a badge
 * around it). Wedges with a zero share draw nothing rather than a
 * zero-length arc.
 */
export default function DonutChart({ wedges, centerValue, centerLabel, ariaLabel }) {
  const slices = wedges.filter((w) => w.share > 0);
  if (slices.length === 0) return null;

  const arcs = slices.reduce((acc, w) => {
    const drawn = acc.length ? acc[acc.length - 1].drawn : 0;
    const length = w.share * CIRCUMFERENCE;
    acc.push({
      ...w,
      length,
      dashoffset: -drawn * CIRCUMFERENCE,
      drawn: drawn + w.share,
      mid: drawn + w.share / 2,
    });
    return acc;
  }, []);

  const labeled = [...arcs].sort((a, b) => b.share - a.share).slice(0, BUBBLE_COUNT);

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

      <svg
        className="donut-leaders"
        viewBox={`0 0 ${CONTAINER_W} ${CONTAINER_H}`}
        aria-hidden="true"
      >
        {labeled.map((a) => {
          const from = pointOnRing(a.mid, RING_OUTER);
          const to = pointOnRing(a.mid, BUBBLE_DIST);
          return (
            <line
              key={a.id}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="var(--line)"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          );
        })}
      </svg>

      <div className="donut-center">
        <span className="donut-total">{centerValue}</span>
        <span className="donut-cap">{centerLabel}</span>
      </div>

      {labeled.map((a) => {
        const p = pointOnRing(a.mid, BUBBLE_DIST);
        const side = p.x >= RING_CENTER_X ? 'right' : 'left';
        return (
          <div
            key={a.id}
            className={`donut-bub donut-bub-${side}`}
            style={{ left: p.x, top: p.y }}
            aria-hidden="true"
          >
            <CategoryBadge category={a.category} />
            <span className="donut-bub-pct">{Math.round(a.share * 100)}%</span>
          </div>
        );
      })}
    </div>
  );
}
