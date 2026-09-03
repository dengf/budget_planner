import React from 'react';
import { categoryColor, categoryIconId } from '../categoryVisuals';
import { CATEGORY_ICONS } from './CategoryIcons';

// Smallest/largest bubble diameter, in px. MIN comfortably clears the
// 44px touch-target floor with room left for the icon; MAX is chosen to
// still read as a compact group on a 375px phone (see main.css's
// `.bubble-grid`).
const MIN_D = 56;
const MAX_D = 140;
// A bubble only gets room for the percentage overlay once it's big enough
// for the text not to collide with the icon.
const PCT_LABEL_MIN_D = 72;

/**
 * A breakdown by category as tap-to-drill-down bubbles, sized by share of
 * the total -- the Dashboard's replacement for PieChart.jsx's donut (see
 * that file's own removal note). `items`: `[{ id, label, value, category
 * }]`, already filtered to the positive values that belong in this chart,
 * same convention PieChart used. `category` is the real category record
 * (not a stripped-down slice) so this can reuse CategoryBadge's own
 * `categoryColor`/`categoryIconId` with no shape translation.
 *
 * Diameter is `sqrt(value / maxValue)`, not a linear scale -- so visual
 * *area*, not diameter, is proportional to value, the standard
 * non-misleading bubble-chart convention. It's relative to the largest
 * item in this chart, not to the grand total, so the largest bubble
 * always renders at MAX_D regardless of how many categories there are.
 *
 * A total of zero draws one muted placeholder bubble instead of an empty
 * gap, matching PieChart's old empty-ring reasoning: a first-time visitor
 * should see where this chart lives, not a hole in the layout. `hint` is
 * the small "tap a bubble to see details" line -- the per-bubble
 * `aria-label` covers screen-reader discovery, but this brand-new
 * interaction pattern also needs a visible cue for a sighted first-time
 * user (this app's own "obvious to use" rule).
 */
export default function BubbleChart({
  title,
  items,
  formatMoney,
  ariaLabel,
  hint,
  emptyHint,
  selectedId,
  onSelect,
}) {
  const total = items.reduce((sum, i) => sum + i.value, 0);
  const isEmpty = total <= 0;
  const sorted = isEmpty ? [] : [...items].sort((a, b) => b.value - a.value);
  const maxValue = sorted[0]?.value ?? 1;

  return (
    <figure className="chart bubble-chart">
      <figcaption className="chart-title">{title}</figcaption>
      {!isEmpty && <p className="chart-note bubble-hint">{hint}</p>}
      {isEmpty ? (
        <>
          <div className="bubble-grid">
            <span
              className="bubble bubble-empty"
              style={{ width: MIN_D * 1.5, height: MIN_D * 1.5 }}
              role="img"
              aria-label={ariaLabel}
            />
          </div>
          <p className="chart-note chart-empty-hint">{emptyHint}</p>
        </>
      ) : (
        <div className="bubble-grid" role="group" aria-label={ariaLabel}>
          {sorted.map((item) => {
            const diameter = Math.round(MIN_D + (MAX_D - MIN_D) * Math.sqrt(item.value / maxValue));
            const pct = Math.round((item.value / total) * 100);
            const Icon = CATEGORY_ICONS[categoryIconId(item.category)];
            const isSelected = selectedId === item.id;
            return (
              <button
                type="button"
                key={item.id}
                className={isSelected ? 'bubble bubble-selected' : 'bubble'}
                style={{
                  width: diameter,
                  height: diameter,
                  background: categoryColor(item.category),
                }}
                aria-pressed={isSelected}
                aria-label={`${item.label}, ${formatMoney(item.value)}, ${pct}%`}
                onClick={() => onSelect(isSelected ? null : item.id)}
              >
                <Icon />
                {diameter >= PCT_LABEL_MIN_D && <span className="bubble-pct">{pct}%</span>}
              </button>
            );
          })}
        </div>
      )}
    </figure>
  );
}
