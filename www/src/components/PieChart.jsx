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
//
// Anchored on meifio's plum (see meifio-brand/README.md's colour table,
// #B01243 light / #F2547F dark) rather than an arbitrary hue -- index 0,
// the biggest wedge since `wedges` is sorted by value descending, sits
// closest to the brand hue (~344deg), each hand-tuned in lightness so
// every entry lands close to a ~4.2:1 contrast ratio against both this
// app's dark background (#0f1720) and print/light-mode white -- the same
// "holds up on both" bar the old arbitrary palette was picked to clear,
// not a new one. This deliberately does NOT touch `--accent` (see
// main.css's own comment on why this app kept mortgage_calculator's
// blue/green instead of meifio's plum) -- that's app-wide chrome, a
// bigger call than one chart's palette.
//
// Ordering: most budgets only ever populate the first handful of these
// ten, so stepping sequentially around the hue wheel (0, 36, 72deg...)
// would put the categories people actually see next to each other in
// value -- and next to each other in hue, the hardest pair to tell
// apart. Instead this jumps by half the wheel (5 of 10) each step --
// 0, 180, 36, 216, 72deg... -- so consecutive palette entries always
// land at least 144deg apart. Whatever prefix of the list a given
// chart actually uses is close to maximally spread, not just the full
// set of ten.
const PALETTE = [
  '#E52E5F',
  '#118D6C',
  '#CC5519',
  '#1681B6',
  '#888011',
  '#656EEC',
  '#498811',
  '#A353EA',
  '#118D22',
  '#DA1BC0',
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

// The chart's outer boundary follows meifio's blossom silhouette
// (meifio-brand/svg/blossom.svg's own path, unmodified) instead of a
// plain circle -- but only as a *clip shape*. The colored regions inside
// it are still ordinary angle-proportional wedges from `wedgePath`
// above, so this has nothing to do with category count: the blossom is
// fixed at 5 petals, but any number of categories clips into the same
// fixed outline. PETAL_D is the mark's single petal path, in its own
// local space centered on (50,50); PETAL_ANGLES rotates 5 copies around
// that center the same way blossom.svg's own <use> elements do.
const PETAL_D = 'M50 50 C41 46 34 38 34 27 A16 16 0 1 1 66 27 C66 38 59 46 50 50 Z';
// Distance from (50,50) to the petal tip (50,11) in PETAL_D's own local
// units -- measured, not guessed, so `flowerScale` below maps that tip to
// exactly R regardless of this path's coordinate scale.
const NATURAL_PETAL_R = 39;
const PETAL_ANGLES = [0, 72, 144, 216, 288];
const flowerScale = R / NATURAL_PETAL_R;

// Radius of the punched-out hole in donut mode, as a fraction of R.
// Sampling PETAL_D shows the 5 petals separate into distinct lobes (with
// gaps between them) outside local radius ~27 of 39, and overlap into a
// plain solid disc inside that (27/39 ~= 0.69). A smaller hole trades
// some of that outer, clearly-5-lobed band for more colored area overall
// -- the innermost sliver of the ring sits in the solid-disc zone (looks
// like a plain ring there), the rest still reads as a flower.
const HOLE_R_RATIO = 0.6;

let nextMaskId = 0;

/**
 * A breakdown by category as wedges of a circle, sized by share of the
 * total. `items`: `[{ id, label, value }]`, already filtered to the
 * positive values that belong in this chart -- an income breakdown and
 * an expense breakdown are two separate instances of this component
 * with two different filtered lists, not one chart trying to show both
 * directions of money at once.
 *
 * A total of zero draws a plain muted ring instead of vanishing -- a
 * first-time visitor with nothing logged yet should still see where this
 * chart lives and what it will look like once there's something to show,
 * not a gap in the layout that reads as broken. `emptyHint` takes the
 * legend's place in that state, since there's nothing yet to enumerate.
 *
 * `hollow` + `centerLabel`/`centerValue` turn the same wedge geometry
 * into a donut with a headline figure at the center (the Dashboard's
 * "Actual Spending" chart) -- an `<svg><mask>` punches the hole so it
 * reads as true transparency regardless of what sits behind the chart,
 * rather than a hardcoded fill that would mismatch the card background
 * in print or a future theme.
 */
export default function PieChart({
  title,
  items,
  formatMoney,
  ariaLabel,
  hollow,
  centerLabel,
  centerValue,
  emptyHint,
}) {
  const total = items.reduce((sum, i) => sum + i.value, 0);
  const isEmpty = total <= 0;

  const sorted = isEmpty ? [] : [...items].sort((a, b) => b.value - a.value);

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

  // A fresh id per mounted instance, not per render -- two donuts on
  // screen at once (or a re-render from new props) must never share or
  // collide on a mask id, which would silently punch the wrong chart's
  // hole.
  const maskId = React.useMemo(() => `pie-donut-mask-${nextMaskId++}`, []);
  const clipId = React.useMemo(() => `pie-flower-clip-${nextMaskId++}`, []);

  return (
    <figure className="chart pie-chart">
      <figcaption className="chart-title">{title}</figcaption>
      <div className="pie-chart-body">
        <svg className="pie-svg" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={ariaLabel}>
          {hollow && (
            <mask id={maskId}>
              <rect width={SIZE} height={SIZE} fill="#fff" />
              <circle cx={CX} cy={CY} r={R * HOLE_R_RATIO} fill="#000" />
            </mask>
          )}
          <clipPath id={clipId}>
            {PETAL_ANGLES.map((deg) => (
              <path
                key={deg}
                d={PETAL_D}
                transform={`translate(${CX} ${CY}) scale(${flowerScale}) translate(-50 -50) rotate(${deg} 50 50)`}
              />
            ))}
          </clipPath>
          <g mask={hollow ? `url(#${maskId})` : undefined} clipPath={`url(#${clipId})`}>
            {isEmpty ? (
              <circle cx={CX} cy={CY} r={R} className="pie-empty-ring" />
            ) : (
              wedges.map((w) =>
                w.path ? (
                  <path key={w.id} d={w.path} fill={w.color} />
                ) : (
                  <circle key={w.id} cx={CX} cy={CY} r={R} fill={w.color} />
                ),
              )
            )}
          </g>
          {hollow && (centerLabel || centerValue) && (
            <g className="pie-donut-center" textAnchor="middle">
              {centerLabel && (
                <text x={CX} y={CY - 6} className="pie-donut-label">
                  {centerLabel}
                </text>
              )}
              {centerValue && (
                <text x={CX} y={centerLabel ? CY + 14 : CY + 5} className="pie-donut-value">
                  {centerValue}
                </text>
              )}
            </g>
          )}
        </svg>
        {isEmpty ? (
          emptyHint && <p className="chart-note pie-empty-hint">{emptyHint}</p>
        ) : (
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
        )}
      </div>
    </figure>
  );
}
