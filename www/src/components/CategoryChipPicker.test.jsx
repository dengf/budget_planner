import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import CategoryChipPicker from './CategoryChipPicker';

const HOUSING = {
  key: 'cat.housing',
  group_key: 'cat.group.expense',
  is_income: false,
  description_key: 'cat.housing.desc',
};

const SALARY = {
  key: 'cat.primaryEarnedIncome',
  group_key: 'cat.group.income',
  is_income: true,
  description_key: 'cat.primaryEarnedIncome.desc',
};

function renderPicker(props) {
  return render(
    <I18nProvider initialLocale="en">
      <CategoryChipPicker presets={[HOUSING]} onAdd={() => {}} {...props} />
    </I18nProvider>,
  );
}

describe('CategoryChipPicker', () => {
  it('renders a chip per preset it is given', () => {
    renderPicker();
    expect(screen.getByRole('button', { name: /Housing/i })).toBeInTheDocument();
  });

  it('calls onAdd with exactly the tapped preset', () => {
    const onAdd = vi.fn();
    renderPicker({ onAdd });
    fireEvent.click(screen.getByRole('button', { name: /Housing/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith(HOUSING);
  });

  it('renders nothing when it is given no presets', () => {
    const { container } = render(
      <I18nProvider initialLocale="en">
        <CategoryChipPicker presets={[]} onAdd={() => {}} />
      </I18nProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('splits income and expense presets into their own labeled groups', () => {
    renderPicker({ presets: [HOUSING, SALARY] });
    const groups = screen.getAllByText(/^(Income|Expense)$/);
    expect(groups.map((el) => el.textContent)).toEqual(['Income', 'Expense']);
    expect(screen.getByRole('button', { name: /Housing/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Primary Earned Income/i })).toBeInTheDocument();
  });

  it('omits a group label entirely when it has no presets to show', () => {
    renderPicker();
    expect(screen.queryByText('Income')).not.toBeInTheDocument();
    expect(screen.getByText('Expense')).toBeInTheDocument();
  });
});
