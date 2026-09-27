import { createContext, useContext } from 'react';

/**
 * Every saved category, for the few things that need to see past the one
 * category they were handed -- today only `CategoryBadge`, which paints a
 * subcategory in its group's color and needs the group to do it. A
 * context rather than a prop because a badge renders in a dozen places,
 * most of them handed a single category by id, and threading the whole
 * list through each would touch every one of them for a display detail.
 *
 * Defaults to an empty list, so a badge rendered outside the provider (a
 * component test) simply shows the category's own look.
 */
export const CategoriesContext = createContext([]);

export function useCategories() {
  return useContext(CategoriesContext);
}
