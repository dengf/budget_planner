import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
const WITH_SUBS = [
  ...CATEGORIES,
  { id: 'salary', name: 'Salary', group: 'Income', is_income: true },
  { id: 'groceries', name: 'Groceries', group: 'Living', is_income: false, parent_id: 'food' },
];

function renderScreen(props) {
  return render(
    <I18nProvider initialLocale="en">
      <CategoriesScreen
        wasmModule={makeWasm()}
        newId={(() => {
          let seq = 0;
          return () => `new-id-${(seq += 1)}`;
        })()}
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
    const remove = await screen.findByRole('button', { name: 'Remove' });
    expect(remove.closest('.category-manage-row')).toHaveTextContent('Food');
  });

  it('lists each subcategory under its group, each with its own Remove', async () => {
    const removeCategory = vi.fn();
    renderScreen({ categories: { items: WITH_SUBS, save: vi.fn() }, removeCategory });
    const rows = await screen.findAllByRole('button', { name: 'Remove' });
    expect(rows.map((b) => b.closest('.category-manage-row').textContent)).toEqual([
      expect.stringContaining('Food'),
      expect.stringContaining('Groceries'),
      expect.stringContaining('Salary'),
    ]);
    expect(rows[1].closest('.category-manage-row')).toHaveClass('category-manage-sub');
    fireEvent.click(rows[1]);
    expect(removeCategory).toHaveBeenCalledWith('groceries');
  });

  it('adds a subcategory under the group it was opened from', async () => {
    const save = vi.fn();
    renderScreen({
      wasmModule: {
        ...makeWasm(),
        resolve_category_name: async ({ typed }) => ({
          outcome: 'create',
          name: typed,
          group_key: 'cat.group.expense',
        }),
      },
      categories: { items: CATEGORIES, save },
    });
    fireEvent.click(await screen.findByRole('button', { name: '+ Add a subcategory' }));
    const field = document.querySelector('.category-add-sub-field');
    fireEvent.change(within(field).getByLabelText('Category name'), {
      target: { value: 'Farmers market' },
    });
    fireEvent.click(within(field).getByRole('button', { name: 'Create “Farmers market”' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Farmers market', parent_id: 'food', is_income: false }),
      ),
    );
  });

  it('files a new category under the chosen group, on the group’s side of the ledger', async () => {
    const save = vi.fn();
    renderScreen({ categories: { items: WITH_SUBS, save } });
    fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Bonus' } });
    fireEvent.change(screen.getByLabelText('Subcategory of'), { target: { value: 'salary' } });
    expect(screen.getByLabelText(/income category/i)).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Add Category' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Bonus', parent_id: 'salary', is_income: true }),
    );
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

const name = (n) => screen.getByLabelText(`Category name, row ${n}`);
const entryType = (n) => screen.getByLabelText(`Entry type, row ${n}`);
const parent = (n) => screen.getByLabelText(`Subcategory of, row ${n}`);

describe('CategoriesScreen desktop rows', () => {
  afterEach(() => {
    delete window.matchMedia;
  });

  it('saves every named row in one submit', async () => {
    mockDesktop();
    const save = vi.fn();
    renderScreen({ categories: { items: CATEGORIES, save } });
    fireEvent.change(name(1), { target: { value: 'Rent' } });
    fireEvent.change(name(2), { target: { value: 'Salary' } });
    fireEvent.change(entryType(2), { target: { value: 'income' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 categories' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Rent', is_income: false }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Salary', is_income: true }));
  });

  it('gives each saved category its own id, so a batch is not one row overwritten', async () => {
    mockDesktop();
    const save = vi.fn();
    renderScreen({ categories: { items: CATEGORIES, save } });
    fireEvent.change(name(1), { target: { value: 'Rent' } });
    fireEvent.change(name(2), { target: { value: 'Salary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 categories' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    const ids = save.mock.calls.map(([c]) => c.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('files each row under its own parent, or none, per row rather than per form', async () => {
    mockDesktop();
    const save = vi.fn();
    renderScreen({ categories: { items: CATEGORIES, save } });
    fireEvent.change(name(1), { target: { value: 'Rent' } });
    fireEvent.change(name(2), { target: { value: 'Salary' } });
    fireEvent.change(entryType(2), { target: { value: 'income' } });
    fireEvent.change(name(3), { target: { value: 'Farmers market' } });
    fireEvent.change(parent(3), { target: { value: 'food' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add 3 categories' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
    const filed = Object.fromEntries(
      save.mock.calls.map(([c]) => [c.name, [c.group, c.parent_id]]),
    );
    expect(filed).toEqual({
      Rent: ['Expense', null],
      Salary: ['Income', null],
      'Farmers market': ['Living', 'food'],
    });
  });

  it('locks a row to its parent’s side of the ledger once one is chosen', () => {
    mockDesktop();
    renderScreen();
    fireEvent.change(entryType(1), { target: { value: 'income' } });
    fireEvent.change(parent(1), { target: { value: 'food' } });
    expect(entryType(1)).toHaveValue('expense');
    expect(entryType(1)).toBeDisabled();
  });

  it('adds a row on Shift+Enter and puts the caret in its name field', async () => {
    mockDesktop();
    renderScreen();
    fireEvent.keyDown(name(1), { key: 'Enter', shiftKey: true });
    await waitFor(() => expect(name(2)).toBeInTheDocument());
    expect(name(2)).toHaveFocus();
  });

  it('moves to the row below on Shift+Enter instead of stranding a blank row above the caret', async () => {
    mockDesktop();
    renderScreen();
    // Typing a name already grows a row underneath, so the shortcut from
    // row 1 should land in that row rather than append a third.
    fireEvent.change(name(1), { target: { value: 'Rent' } });
    fireEvent.keyDown(name(1), { key: 'Enter', shiftKey: true });
    await waitFor(() => expect(name(2)).toHaveFocus());
    expect(screen.queryByLabelText('Category name, row 3')).not.toBeInTheDocument();
  });

  it('grows a fresh row once a name is typed in the last one', () => {
    mockDesktop();
    renderScreen();
    expect(screen.queryByLabelText('Category name, row 2')).not.toBeInTheDocument();
    fireEvent.change(name(1), { target: { value: 'Rent' } });
    expect(name(2)).toBeInTheDocument();
  });

  it('adds a row from the button, for anyone who never finds the shortcut', () => {
    mockDesktop();
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: '+ Add a row' }));
    expect(name(2)).toBeInTheDocument();
  });

  it('removes a row, and never the last one', () => {
    mockDesktop();
    renderScreen();
    expect(screen.getByRole('button', { name: 'Remove row 1' })).toBeDisabled();
    fireEvent.change(name(1), { target: { value: 'Rent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove row 1' }));
    expect(name(1)).toHaveValue('');
    expect(screen.queryByLabelText('Category name, row 2')).not.toBeInTheDocument();
  });

  it('will not submit an unnamed row, so the button never promises nothing', () => {
    mockDesktop();
    const save = vi.fn();
    renderScreen({ categories: { items: CATEGORIES, save } });
    expect(screen.getByRole('button', { name: 'Add Category' })).toBeDisabled();
    // A parent with no name is not a category -- the name is the whole of
    // one, which is why it alone gates the submit.
    fireEvent.change(parent(1), { target: { value: 'food' } });
    expect(screen.getByRole('button', { name: 'Add Category' })).toBeDisabled();
    fireEvent.change(name(1), { target: { value: 'Rent' } });
    expect(screen.getByRole('button', { name: 'Add Category' })).toBeEnabled();
    expect(save).not.toHaveBeenCalled();
  });

  it('clears the rows after a batch, ready for the next one', async () => {
    mockDesktop();
    const save = vi.fn();
    renderScreen({ categories: { items: CATEGORIES, save } });
    fireEvent.change(name(1), { target: { value: 'Rent' } });
    fireEvent.change(name(2), { target: { value: 'Salary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 categories' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(name(1)).toHaveValue(''));
    expect(screen.queryByLabelText('Category name, row 2')).not.toBeInTheDocument();
  });

  it('keeps "Add common categories" beside the batch submit', () => {
    mockDesktop();
    const addCommonCategories = vi.fn();
    renderScreen({ addCommonCategories });
    fireEvent.click(screen.getByRole('button', { name: 'Add common categories' }));
    expect(addCommonCategories).toHaveBeenCalled();
  });

  it('shows the shortcut hint on desktop', () => {
    mockDesktop();
    renderScreen();
    expect(screen.getByText('Shift + Enter adds a row')).toBeInTheDocument();
  });
});

describe('CategoriesScreen on the phone shell', () => {
  afterEach(() => {
    delete window.matchMedia;
  });

  // window.matchMedia is left unmocked, matching this codebase's default
  // "phone shell" behaviour (see useIsDesktop.js).
  it('keeps the single draft form, which is what fits 375px', () => {
    renderScreen();
    expect(screen.getByLabelText('Category name')).toBeInTheDocument();
    expect(screen.queryByLabelText('Category name, row 1')).not.toBeInTheDocument();
  });

  it('saves the one draft category, income flag and all', async () => {
    const save = vi.fn();
    renderScreen({ categories: { items: CATEGORIES, save } });
    fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Salary' } });
    fireEvent.click(screen.getByLabelText('This is an income category'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Category' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Salary', is_income: true, group: 'Income' }),
      ),
    );
    await waitFor(() => expect(screen.getByLabelText('Category name')).toHaveValue(''));
  });

  it('hides the row shortcut hint, since there are no rows here', () => {
    renderScreen();
    expect(screen.queryByText('Shift + Enter adds a row')).not.toBeInTheDocument();
  });
});
