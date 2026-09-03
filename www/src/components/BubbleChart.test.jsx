import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BubbleChart from './BubbleChart';

const formatMoney = (n) => `$${n.toFixed(2)}`;

const items = [
  { id: 'a', label: 'Housing', value: 1000, category: { preset_key: 'cat.housing' } },
  { id: 'b', label: 'Utilities', value: 100, category: { preset_key: 'cat.utilities' } },
];

describe('BubbleChart', () => {
  it('renders one bubble per item', () => {
    const { container } = render(
      <BubbleChart title="Spending" items={items} formatMoney={formatMoney} onSelect={() => {}} />,
    );
    expect(container.querySelectorAll('.bubble').length).toBe(2);
  });

  it('shows the category name under each bubble', () => {
    const { getByText } = render(
      <BubbleChart title="Spending" items={items} formatMoney={formatMoney} onSelect={() => {}} />,
    );
    expect(getByText('Housing')).toBeInTheDocument();
    expect(getByText('Utilities')).toBeInTheDocument();
  });

  it('sizes the largest item at the max diameter', () => {
    const { container } = render(
      <BubbleChart title="Spending" items={items} formatMoney={formatMoney} onSelect={() => {}} />,
    );
    const bubbles = container.querySelectorAll('.bubble');
    expect(bubbles[0].style.width).toBe('140px');
    expect(parseInt(bubbles[1].style.width, 10)).toBeLessThan(140);
  });

  it('renders a muted placeholder bubble when the total is zero', () => {
    const { container } = render(
      <BubbleChart
        title="Spending"
        items={[]}
        formatMoney={formatMoney}
        emptyHint="Nothing yet"
        onSelect={() => {}}
      />,
    );
    expect(container.querySelector('.bubble-empty')).toBeInTheDocument();
    expect(container.querySelectorAll('.bubble').length).toBe(1);
  });

  it('fires onSelect with the tapped item id', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <BubbleChart title="Spending" items={items} formatMoney={formatMoney} onSelect={onSelect} />,
    );
    fireEvent.click(container.querySelectorAll('.bubble')[0]);
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('fires onSelect with null when tapping an already-selected bubble', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <BubbleChart
        title="Spending"
        items={items}
        formatMoney={formatMoney}
        selectedId="a"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(container.querySelectorAll('.bubble')[0]);
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
