import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CategoryBreakdown from './CategoryBreakdown';

const formatMoney = (n) => `$${n.toFixed(2)}`;

const expenseItems = [
  { id: 'a', label: 'Housing', value: 1000, category: { preset_key: 'cat.housing' } },
  { id: 'b', label: 'Utilities', value: 100, category: { preset_key: 'cat.utilities' } },
];
const incomeItems = [
  { id: 'c', label: 'Salary', value: 500, category: { preset_key: 'cat.primaryEarnedIncome' } },
];

const tabs = [
  { key: 'expense', label: 'Spending', items: expenseItems, emptyHint: 'Nothing spent yet' },
  { key: 'income', label: 'Income', items: incomeItems, emptyHint: 'Nothing earned yet' },
];

describe('CategoryBreakdown', () => {
  it('opens on the first tab by default', () => {
    const { getByText, queryByText } = render(
      <CategoryBreakdown tabs={tabs} formatMoney={formatMoney} onSelect={() => {}} />,
    );
    expect(getByText('Housing')).toBeInTheDocument();
    expect(queryByText('Salary')).not.toBeInTheDocument();
  });

  it("switches tabs on tap, showing that tab's rows instead", () => {
    const { getByText, queryByText } = render(
      <CategoryBreakdown tabs={tabs} formatMoney={formatMoney} onSelect={() => {}} />,
    );
    fireEvent.click(getByText('Income'));
    expect(getByText('Salary')).toBeInTheDocument();
    expect(queryByText('Housing')).not.toBeInTheDocument();
  });

  it('marks the active tab button', () => {
    const { getByText } = render(
      <CategoryBreakdown tabs={tabs} formatMoney={formatMoney} onSelect={() => {}} />,
    );
    expect(getByText('Spending')).toHaveAttribute('aria-pressed', 'true');
    expect(getByText('Income')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(getByText('Income'));
    expect(getByText('Income')).toHaveAttribute('aria-pressed', 'true');
  });

  it("sizes each row bar by its own share of that tab's total", () => {
    const { container } = render(
      <CategoryBreakdown tabs={tabs} formatMoney={formatMoney} onSelect={() => {}} />,
    );
    const bars = container.querySelectorAll('.cat-row-bar');
    expect(bars[0].style.width).toBe('91%');
    expect(bars[1].style.width).toBe('9%');
  });

  it("shows that tab's empty hint and no rows when its total is zero", () => {
    const { getByText, container } = render(
      <CategoryBreakdown
        tabs={[
          { key: 'expense', label: 'Spending', items: [], emptyHint: 'Nothing yet' },
          { key: 'income', label: 'Income', items: incomeItems },
        ]}
        formatMoney={formatMoney}
        onSelect={() => {}}
      />,
    );
    expect(getByText('Nothing yet')).toBeInTheDocument();
    expect(container.querySelectorAll('.cat-row').length).toBe(0);
  });

  it('fires onSelect with the tapped item id', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <CategoryBreakdown tabs={tabs} formatMoney={formatMoney} onSelect={onSelect} />,
    );
    fireEvent.click(container.querySelectorAll('.cat-row')[0]);
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('fires onSelect with null when tapping an already-selected row', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <CategoryBreakdown
        tabs={tabs}
        formatMoney={formatMoney}
        selectedId="a"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(container.querySelectorAll('.cat-row')[0]);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('renders the detail slot immediately after the selected item', () => {
    const { container } = render(
      <CategoryBreakdown
        tabs={tabs}
        formatMoney={formatMoney}
        selectedId="a"
        onSelect={() => {}}
        detail={<p>Housing details</p>}
      />,
    );
    const list = container.querySelector('.cat-rows');
    const children = [...list.children];
    const itemIndex = children.findIndex((c) => c.textContent.includes('Housing'));
    expect(children[itemIndex + 1]).toHaveClass('cat-detail-slot');
    expect(children[itemIndex + 1].textContent).toBe('Housing details');
  });
});
