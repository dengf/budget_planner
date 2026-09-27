import React from 'react';
import { useI18n } from '../i18n';
import { categoryDisplayName } from '../presetCategories';

/**
 * "Subcategory of": the parent picker behind both of the Categories
 * screen's add forms. `''` means a category of its own. Groups are
 * listed income first, then expense, in the order the budget holds them.
 */
export default function SubcategoryOfSelect({ groups, value, onChange, ariaLabel }) {
  const { t } = useI18n();
  const ordered = [...groups.filter((g) => g.is_income), ...groups.filter((g) => !g.is_income)];
  return (
    <select
      className="field-select"
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{t('category.topLevel')}</option>
      {ordered.map((g) => (
        <option key={g.id} value={g.id}>
          {categoryDisplayName(g, t)}
        </option>
      ))}
    </select>
  );
}
