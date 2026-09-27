import React from 'react';
import { useI18n } from '../i18n';
import { categoryDisplayName, categoryTree } from '../presetCategories';

/**
 * The `<option>`s for a category `<select>`, grouped the way the budget
 * is: a group with subcategories becomes an `<optgroup>` headed by its
 * name, holding the group itself first (it is a complete answer on its
 * own -- an optgroup label can't be selected) and then its
 * subcategories, so "Utilities" reads as belonging to Housing &
 * Utilities rather than as a stray name in a flat list.
 *
 * Shared by every category dropdown -- the transaction rows and both
 * rules forms -- so a subcategory is reachable, and recognisable, from
 * each of them the same way.
 */
export default function CategoryOptions({ categories }) {
  const { t } = useI18n();
  const tree = categoryTree(categories);
  const option = (x) => (
    <option key={x.id} value={x.id}>
      {categoryDisplayName(x, t)}
    </option>
  );
  return tree.tops.map((c) => {
    const subs = tree.childrenOf(c.id);
    if (subs.length === 0) return option(c);
    return (
      <optgroup key={c.id} label={categoryDisplayName(c, t)}>
        {option(c)}
        {subs.map(option)}
      </optgroup>
    );
  });
}
