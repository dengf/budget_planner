import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import CategoryPicker from './CategoryPicker';

const CREATE = {
  create: vi.fn(),
  availableIncomePresets: [],
  availableExpensePresets: [],
  availableSubPresets: () => [],
  presetsReady: true,
};

// Ranked the way useCategoryRank hands them over: Groceries is the most
// used, so its group should lead the row even though the group itself
// has never been picked directly.
const ORDERED = [
  { id: 'groceries', name: 'Groceries', parent_id: 'food', is_income: false },
  { id: 'rent', name: 'Rent', is_income: false },
  { id: 'food', name: 'Food', is_income: false },
  { id: 'care', name: 'Toiletries', parent_id: 'food', is_income: false },
];

function renderPicker(props) {
  const onChange = vi.fn();
  render(
    <I18nProvider initialLocale="en">
      <CategoryPicker
        ordered={ORDERED}
        value=""
        onChange={onChange}
        isIncome={false}
        createCategory={CREATE}
        {...props}
      />
    </I18nProvider>,
  );
  return { onChange };
}

const chipNames = (container) =>
  [...container.querySelectorAll(':scope > .category-chip:not(.category-chip-new)')]
    .filter((b) => !b.classList.contains('category-chip-more'))
    .map((b) => b.textContent);

describe('CategoryPicker groups and subcategories', () => {
  it('shows groups only, ranked by their most-used subcategory', () => {
    renderPicker();
    const row = document.querySelector('.category-picker > .category-chips');
    expect(chipNames(row)).toEqual(['Food', 'Rent']);
    expect(screen.queryByText('More specific (optional)')).not.toBeInTheDocument();
  });

  it('offers a chosen group’s subcategories as an optional second step', () => {
    renderPicker({ value: 'food' });
    expect(screen.getByText('More specific (optional)')).toBeInTheDocument();
    const subs = document.querySelector('.category-picker-subs .category-chips');
    expect(chipNames(subs)).toEqual(['Groceries', 'Toiletries']);
  });

  it('keeps the group lit while one of its subcategories is chosen', () => {
    renderPicker({ value: 'groceries' });
    expect(screen.getByRole('button', { name: 'Food' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Groceries' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('steps back up to the group when the chosen subcategory is tapped again', () => {
    const { onChange } = renderPicker({ value: 'groceries' });
    fireEvent.click(screen.getByRole('button', { name: 'Groceries' }));
    expect(onChange).toHaveBeenCalledWith('food');
  });

  it('switches to the group itself when its chip is tapped from a subcategory', () => {
    const { onChange } = renderPicker({ value: 'groceries' });
    fireEvent.click(screen.getByRole('button', { name: 'Food' }));
    expect(onChange).toHaveBeenCalledWith('food');
  });

  it('clears when the chosen group is tapped again', () => {
    const { onChange } = renderPicker({ value: 'food' });
    fireEvent.click(screen.getByRole('button', { name: 'Food' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('lets "All" find a subcategory by name', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.change(screen.getByLabelText('Find a category'), { target: { value: 'toil' } });
    expect(screen.getByRole('button', { name: 'Toiletries' })).toBeInTheDocument();
  });
});
