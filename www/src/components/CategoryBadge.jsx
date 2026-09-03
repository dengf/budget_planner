import React from 'react';
import { categoryColor, categoryIconId } from '../categoryVisuals';
import { CATEGORY_ICONS } from './CategoryIcons';

/**
 * A small colored circle with a category's icon, meant to sit inline
 * right before its name (Dashboard, Budget, Transactions) so a list of
 * categories reads at a glance instead of as plain text rows. Decorative
 * only -- `aria-hidden`, since the adjacent name text is always the
 * accessible label. `category` may be `undefined` (a stale/deleted
 * category id still referenced by a transaction) -- `categoryColor`/
 * `categoryIconId` both already handle that via optional chaining.
 */
export default function CategoryBadge({ category }) {
  const Icon = CATEGORY_ICONS[categoryIconId(category)];
  return (
    <span
      className="category-badge"
      style={{ background: categoryColor(category) }}
      aria-hidden="true"
    >
      <Icon />
    </span>
  );
}
