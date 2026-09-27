import React from 'react';
import { categoryColor, categoryIconId } from '../categoryVisuals';
import { useCategories } from '../categoryContext';
import { CATEGORY_ICONS } from './CategoryIcons';

/**
 * A small colored circle with a category's icon, meant to sit inline
 * right before its name (Dashboard, Budget, Transactions) so a list of
 * categories reads at a glance instead of as plain text rows. Decorative
 * only -- `aria-hidden`, since the adjacent name text is always the
 * accessible label. `category` may be `undefined` (a stale/deleted
 * category id still referenced by a transaction) -- `categoryColor`/
 * `categoryIconId` both already handle that via optional chaining.
 *
 * A subcategory wears its group's color (and icon, unless it has its
 * own): the group is looked up by `parent_id` among the saved categories,
 * or -- for a starter preset not yet added, which has no id -- named by
 * its `parent_key`.
 */
export default function CategoryBadge({ category }) {
  const categories = useCategories();
  const parent =
    (category?.parent_id && categories.find((c) => c.id === category.parent_id)) ||
    (category?.parent_key ? { preset_key: category.parent_key } : null);
  const Icon = CATEGORY_ICONS[categoryIconId(category, parent)];
  return (
    <span
      className="category-badge"
      style={{ background: categoryColor(category, parent) }}
      aria-hidden="true"
    >
      <Icon />
    </span>
  );
}
