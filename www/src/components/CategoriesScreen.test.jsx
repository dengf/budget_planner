import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import CategoriesScreen from './CategoriesScreen';

function makeWasm() {
  return {
    spend_by_category: async () => ({ totals: [] }),
    income_by_category: async () => ({ totals: [] }),
    build_month: async ({ planned, income_category_ids }) => {
      const lines = planned.map((p) => ({
        category_id: p.category_id,
        planned: p.amount,
        spent: 0,
        remaining: p.amount,
      }));
      const isIncomeLine = (l) => income_category_ids.includes(l.category_id);
      const income = lines.filter(isIncomeLine).reduce((s, l) => s + l.planned, 0);
      return {
        lines,
        summary: { income, total_planned: 0, total_spent: 0, unassigned: income },
      };
    },
    build_savings_line: async ({ planned, income }) => ({
      line: { planned, spent: Math.max(0, income), remaining: planned - Math.max(0, income) },
    }),
    preset_categories: async () => [],
    required_contribution: async ({ target_amount, current_amount, months_remaining }) => ({
      amount: Math.max(0, (target_amount - current_amount) / Math.max(1, months_remaining)),
    }),
    new_id: () => 'new-id',
  };
}

const CATEGORIES = [{ id: 'food', name: 'Food', group: 'Living', is_income: false }];

function renderScreen(props) {
  return render(
    <I18nProvider initialLocale="en">
      <CategoriesScreen
        wasmModule={makeWasm()}
        currencySymbol="$"
        viewMonth="2026-01"
        categories={{ items: CATEGORIES, save: vi.fn() }}
        removeCategory={vi.fn()}
        addCommonCategories={vi.fn()}
        addPresetCategory={vi.fn()}
        transactions={{ items: [] }}
        budgetPlan={{ items: [], save: vi.fn() }}
        goals={{ items: [] }}
        debts={{ items: [] }}
        {...props}
      />
    </I18nProvider>,
  );
}

describe('CategoriesScreen', () => {
  it('lists existing categories with a Remove button', async () => {
    renderScreen();
    expect(await screen.findByText('Food')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('removes a category on tap', async () => {
    const removeCategory = vi.fn();
    renderScreen({ removeCategory });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(removeCategory).toHaveBeenCalledWith('food');
  });

  it('adds a category from the name/group form', async () => {
    const save = vi.fn();
    renderScreen({ categories: { items: CATEGORIES, save } });
    fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Rent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Category' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Rent', is_income: false }));
  });

  it('shows the Savings row once build_savings_line resolves', async () => {
    renderScreen();
    expect(await screen.findByRole('heading', { name: 'Savings' })).toBeInTheDocument();
  });

  it('shows the commitments table only once the toggle is on', async () => {
    renderScreen({
      goals: {
        items: [
          {
            id: 'g1',
            name: 'Emergency fund',
            target_amount: 1200,
            current_amount: 0,
            target_date: '2026-12-01',
          },
        ],
      },
    });
    expect(screen.queryByText('Goals & debt this month')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByLabelText(/Count goal contributions/));
    expect(await screen.findByText('Goals & debt this month')).toBeInTheDocument();
  });
});

function mockDesktop() {
  window.matchMedia = vi.fn(() => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('CategoriesScreen category name field', () => {
  afterEach(() => {
    delete window.matchMedia;
  });

  it('adds the category on Shift+Enter on desktop, without a click', async () => {
    mockDesktop();
    const save = vi.fn();
    renderScreen({ categories: { items: CATEGORIES, save } });
    fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Rent' } });
    fireEvent.keyDown(screen.getByLabelText('Category name'), { key: 'Enter', shiftKey: true });
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Rent' })),
    );
  });

  it('clears the draft and refocuses the name field after Shift+Enter', async () => {
    mockDesktop();
    renderScreen({ categories: { items: CATEGORIES, save: vi.fn() } });
    fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Rent' } });
    fireEvent.keyDown(screen.getByLabelText('Category name'), { key: 'Enter', shiftKey: true });
    await waitFor(() => expect(screen.getByLabelText('Category name')).toHaveValue(''));
    expect(screen.getByLabelText('Category name')).toHaveFocus();
  });

  it('ignores Shift+Enter on the phone shell, since this is a desktop-only shortcut', () => {
    // window.matchMedia is left unmocked, matching this codebase's default
    // "phone shell" behaviour (see useIsDesktop.js).
    const save = vi.fn();
    renderScreen({ categories: { items: CATEGORIES, save } });
    fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Rent' } });
    fireEvent.keyDown(screen.getByLabelText('Category name'), { key: 'Enter', shiftKey: true });
    expect(save).not.toHaveBeenCalled();
  });

  it('shows the shortcut hint on desktop', () => {
    mockDesktop();
    renderScreen();
    expect(screen.getByText('Shift + Enter adds a row')).toBeInTheDocument();
  });

  it('hides the shortcut hint on the phone shell, since the shortcut does nothing there', () => {
    renderScreen();
    expect(screen.queryByText('Shift + Enter adds a row')).not.toBeInTheDocument();
  });
});
