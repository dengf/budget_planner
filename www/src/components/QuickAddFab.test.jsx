import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import QuickAddFab from './QuickAddFab';

const CATEGORIES = [
  { id: 'c2', name: 'Utilities', is_income: false },
  { id: 'c1', name: 'Groceries', is_income: false },
];

function renderFab(props) {
  return render(
    <I18nProvider initialLocale="en">
      <QuickAddFab categories={CATEGORIES} onPick={() => {}} {...props} />
    </I18nProvider>,
  );
}

describe('QuickAddFab', () => {
  it('renders nothing when there are no categories to log against', () => {
    const { container } = render(
      <I18nProvider initialLocale="en">
        <QuickAddFab categories={[]} onPick={() => {}} />
      </I18nProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('opens the category picker when tapped', () => {
    renderFab();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add a transaction/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('lists categories alphabetically regardless of the order it was given', () => {
    renderFab();
    fireEvent.click(screen.getByRole('button', { name: /add a transaction/i }));
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent);
    expect(items).toEqual(['Groceries', 'Utilities']);
  });

  it('calls onPick with the tapped category id and closes the picker', () => {
    const onPick = vi.fn();
    renderFab({ onPick });
    fireEvent.click(screen.getByRole('button', { name: /add a transaction/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Groceries/i }));
    expect(onPick).toHaveBeenCalledWith('c1');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
