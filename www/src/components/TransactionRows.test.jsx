import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import TransactionRows from './TransactionRows';

const EXPENSE = [
  { id: 'rent', name: 'Rent', is_income: false },
  { id: 'housing', name: 'Housing & Utilities', is_income: false },
  { id: 'power', name: 'Power', is_income: false, parent_id: 'housing' },
];

describe('TransactionRows category column', () => {
  it('files each subcategory under its group, with the group itself still pickable', () => {
    render(
      <I18nProvider initialLocale="en">
        <TransactionRows
          rows={[{ key: 'r1', isIncome: false, amount: '', description: '', date: '' }]}
          onRowChange={vi.fn()}
          onAddRow={vi.fn()}
          onRemoveRow={vi.fn()}
          expenseCategories={EXPENSE}
          incomeCategories={[]}
          categoryValue={() => ''}
          today="2026-09-27"
        />
      </I18nProvider>,
    );
    const select = screen.getByLabelText('Category, row 1');
    const group = select.querySelector('optgroup');
    expect(group).toHaveAttribute('label', 'Housing & Utilities');
    expect([...group.querySelectorAll('option')].map((o) => o.value)).toEqual(['housing', 'power']);
    // A category with no subcategories stays a plain option.
    expect(select.querySelector(':scope > option[value="rent"]')).not.toBeNull();
  });
});
