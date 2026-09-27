import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CategoryBadge from './CategoryBadge';
import { categoryIconId } from '../categoryVisuals';

describe('CategoryBadge', () => {
  it('renders the house icon for the Housing & Utilities group', () => {
    const { container } = render(
      <CategoryBadge category={{ id: 'c1', preset_key: 'cat.housingUtilities' }} />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(categoryIconId({ preset_key: 'cat.housingUtilities' })).toBe('house');
  });

  it('renders the bolt icon for the Utilities subcategory', () => {
    expect(categoryIconId({ preset_key: 'cat.utilityBills' })).toBe('bolt');
  });

  it('falls back to the expense-generic icon for a hand-typed expense category', () => {
    expect(categoryIconId({ preset_key: undefined, is_income: false })).toBe('expense-generic');
  });

  it('falls back to the income-generic icon for a hand-typed income category', () => {
    expect(categoryIconId({ preset_key: undefined, is_income: true })).toBe('income-generic');
  });

  it('renders the repeat icon for the Subscriptions & Streaming subcategory', () => {
    expect(categoryIconId({ preset_key: 'cat.subscriptionsStreaming' })).toBe('repeat');
  });

  it('renders the gift icon for the Gifts & Donations subcategory', () => {
    expect(categoryIconId({ preset_key: 'cat.giftsGiving' })).toBe('gift');
  });

  it('renders a badge with a background color even for an undefined category', () => {
    const { container } = render(<CategoryBadge category={undefined} />);
    const badge = container.querySelector('.category-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.style.background).not.toBe('');
  });
});
