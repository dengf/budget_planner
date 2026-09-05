import React, { useState } from 'react';
import { useI18n } from '../i18n';
import { categoryColor, categoryIconId } from '../categoryVisuals';
import { CATEGORY_ICONS } from './CategoryIcons';

/**
 * The two directions money moves in a month -- spending by category, income
 * by source -- as one card with a tab switcher, rather than two separate
 * charts stacked or side by side. They used to be two `<figure>`s; a phone
 * screen only has room to make one of them the hero of this section at a
 * time, and a tab switch is the standard way to say "same slot, pick which
 * one" without permanently sacrificing half the width to each. Spending
 * opens first (`tabs[0]`) since it's the number most people check first.
 *
 * Each tab is `{ key, label, items, totalLabel, hint, emptyHint, ariaLabel }`.
 * `items`: `[{ id, label, value, category }]`, already filtered to the
 * positive values that belong in that tab, same convention this component
 * always used. `category` is the real category record so a row can reuse
 * CategoryBadge's own `categoryColor`/`categoryIconId` with no shape
 * translation.
 *
 * `selectedId`/`onSelect` are shared across tabs (Dashboard owns the
 * state) -- switching tabs while a row is open just closes it, since the
 * newly-active tab's own items won't include that id. `detail`, optional,
 * is the already-built drill-down panel for whichever item is currently
 * `selectedId` in the *active* tab; Dashboard computes it (it needs data
 * this component doesn't have). Rendered as the next row in the list,
 * immediately after the tapped item.
 */
export default function CategoryBreakdown({ tabs, formatMoney, selectedId, onSelect, detail }) {
  const { t } = useI18n();
  const [activeKey, setActiveKey] = useState(tabs[0].key);
  const active = tabs.find((tab) => tab.key === activeKey) ?? tabs[0];

  const total = active.items.reduce((sum, i) => sum + i.value, 0);
  const isEmpty = total <= 0;
  const sorted = isEmpty ? [] : [...active.items].sort((a, b) => b.value - a.value);

  return (
    <figure className="chart cat-chart">
      <div className="chart-header">
        {/* Reuses .chart-granularity/.app-region -- the same segmented-pill
            toggle group SpendOverTimeChart.jsx uses for its Daily/Weekly
            switch, just with two longer labels instead of two short ones
            (see `.cat-breakdown-tabs`'s own rule for the width/wrap tweak
            that difference needs). */}
        <div
          className="chart-granularity cat-breakdown-tabs"
          role="group"
          aria-label={t('chart.breakdownGroup')}
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={tab.key === activeKey ? 'app-region active' : 'app-region'}
              aria-pressed={tab.key === activeKey}
              onClick={() => setActiveKey(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {active.totalLabel != null && <span className="chart-total">{active.totalLabel}</span>}
      </div>
      {!isEmpty && active.hint && <p className="chart-note cat-hint">{active.hint}</p>}
      {isEmpty ? (
        <p className="chart-note chart-empty-hint">{active.emptyHint}</p>
      ) : (
        <ul className="cat-rows" aria-label={active.ariaLabel}>
          {sorted.map((item) => {
            const pct = Math.round((item.value / total) * 100);
            const Icon = CATEGORY_ICONS[categoryIconId(item.category)];
            const color = categoryColor(item.category);
            const isSelected = selectedId === item.id;
            return (
              <React.Fragment key={item.id}>
                <li>
                  <button
                    type="button"
                    className={isSelected ? 'cat-row cat-row-selected' : 'cat-row'}
                    aria-pressed={isSelected}
                    aria-label={`${item.label}, ${formatMoney(item.value)}, ${pct}%`}
                    onClick={() => onSelect(isSelected ? null : item.id)}
                  >
                    <span className="cat-row-icon" style={{ background: color }}>
                      <Icon />
                    </span>
                    <span className="cat-row-body">
                      <span className="cat-row-top">
                        <span className="cat-row-name">{item.label}</span>
                        <span className="cat-row-amount">{formatMoney(item.value)}</span>
                      </span>
                      <span className="cat-row-track">
                        <span
                          className="cat-row-bar"
                          style={{ width: `${pct}%`, background: color }}
                        />
                      </span>
                    </span>
                    <span className="cat-row-pct">{pct}%</span>
                  </button>
                </li>
                {isSelected && detail && <li className="cat-detail-slot">{detail}</li>}
              </React.Fragment>
            );
          })}
        </ul>
      )}
    </figure>
  );
}
