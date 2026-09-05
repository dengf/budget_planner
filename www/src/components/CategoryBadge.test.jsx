import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CategoryBadge from './CategoryBadge';
import { categoryIconId } from '../categoryVisuals';

describe('CategoryBadge', () => {
  it('renders the housing icon for a category created from the housing preset', () => {
    const { container } = render(
      <CategoryBadge category={{ id: 'c1', preset_key: 'cat.housing' }} />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(categoryIconId({ preset_key: 'cat.housing' })).toBe('house');
  });

  it('renders the utilities icon for a category created from the utilities preset', () => {
    expect(categoryIconId({ preset_key: 'cat.utilities' })).toBe('bolt');
  });

  it('falls back to the expense-generic icon for a hand-typed expense category', () => {
    expect(categoryIconId({ preset_key: undefined, is_income: false })).toBe('expense-generic');
  });

  it('falls back to the income-generic icon for a hand-typed income category', () => {
    expect(categoryIconId({ preset_key: undefined, is_income: true })).toBe('income-generic');
  });

  it('renders the repeat icon for a category created from the subscriptions preset', () => {
    expect(categoryIconId({ preset_key: 'cat.subscriptionsMemberships' })).toBe('repeat');
  });

  it('renders the gift icon for a category created from the gifts preset', () => {
    expect(categoryIconId({ preset_key: 'cat.giftsDonations' })).toBe('gift');
  });

  it('renders a badge with a background color even for an undefined category', () => {
    const { container } = render(<CategoryBadge category={undefined} />);
    const badge = container.querySelector('.category-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.style.background).not.toBe('');
  });
});
