import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import TransactionsTab from './TransactionsTab';

/**
 * Stands in for `budget_wasm::uncategorized`, which wraps
 * `budget_calc::is_uncategorized` -- including the case a local
 * `!tx.category_id` filter misses, a row pointing at a category that no
 * longer exists. The rule itself is tested in Rust.
 */
const WASM = {
  uncategorized: async ({ transactions, existing_category_ids }) => {
    const ids = transactions
      .filter((t) => !t.category_id?.trim() || !existing_category_ids.includes(t.category_id))
      .map((t) => t.id);
    return { ids, count: ids.length, error: null };
  },
};

function renderTab(props) {
  return render(
    <I18nProvider initialLocale="en">
      <TransactionsTab
        wasmModule={WASM}
        currencySymbol="$"
        today="2026-01-01"
        viewMonth="2026-01-01"
        setViewMonth={() => {}}
        confirm={() => Promise.resolve(true)}
        categories={{ items: [] }}
        transactions={{ items: [], save: vi.fn(), remove: vi.fn() }}
        {...props}
      />
    </I18nProvider>,
  );
}

describe('TransactionsTab', () => {
  it('offers Log a transaction and Import CSV as the empty-state actions', () => {
    renderTab();
    expect(screen.getByRole('button', { name: 'Log a transaction' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import CSV' })).toBeInTheDocument();
  });

  // The sheet itself lives in AppShell now, behind the nav bar's centre
  // "+", so what this tab owns is which method it asks for -- and asking
  // for the right one is the whole point of having two buttons: an
  // "Import CSV" button that opened onto the Manual form would read as
  // broken.
  it('asks the shell for the Manual method when "Log a transaction" is tapped', () => {
    const onOpenAdd = vi.fn();
    renderTab({ onOpenAdd });
    fireEvent.click(screen.getByRole('button', { name: 'Log a transaction' }));
    expect(onOpenAdd).toHaveBeenCalledWith('manual');
  });

  it('asks the shell for the CSV method when "Import CSV" is tapped', () => {
    const onOpenAdd = vi.fn();
    renderTab({ onOpenAdd });
    fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }));
    expect(onOpenAdd).toHaveBeenCalledWith('csv');
  });

  // Both used to render as collapsed <details> under the list. They are
  // setup, not daily use, so they moved to More -- and the point of the
  // move is that this tab is the list and nothing else.
  it('leaves categorization rules and recurring setup to the More tab', () => {
    renderTab();
    expect(screen.queryByText('Categorization rules')).not.toBeInTheDocument();
    expect(screen.queryByText('Recurring expenses')).not.toBeInTheDocument();
  });
});

const CATEGORIES = { items: [{ id: 'exp1', name: 'Housing', is_income: false }] };

const ROWS = [
  { id: 't1', date: '2026-01-05', description: 'Rent', amount: -500, category_id: 'exp1' },
  { id: 't2', date: '2026-01-06', description: 'Coffee', amount: -4.5, category_id: null },
  // Points at a category that has since been deleted -- still needs one,
  // and a local `!tx.category_id` filter would call it categorized.
  { id: 't3', date: '2026-01-07', description: 'Taxi', amount: -12, category_id: 'gone' },
];

function renderList(props) {
  return renderTab({
    viewMonth: '2026-01',
    categories: CATEGORIES,
    transactions: { items: ROWS, save: vi.fn(), remove: vi.fn() },
    ...props,
  });
}

describe('TransactionsTab correction loop', () => {
  it('tapping a row asks the shell to edit that transaction', async () => {
    const onEditTransaction = vi.fn();
    renderList({ onEditTransaction });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Rent' }));
    expect(onEditTransaction).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
  });

  it('counts the rows that still need a category, including a deleted one', async () => {
    renderList();
    expect(await screen.findByRole('button', { name: 'Uncategorized (2)' })).toBeInTheDocument();
  });

  it('filters down to exactly the rows the count named', async () => {
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: 'Uncategorized (2)' }));
    await waitFor(() => expect(screen.queryByText('Rent')).not.toBeInTheDocument());
    expect(screen.getByText('Coffee')).toBeInTheDocument();
    expect(screen.getByText('Taxi')).toBeInTheDocument();
  });

  it('shows the whole list again when the filter is tapped off', async () => {
    renderList();
    const chip = await screen.findByRole('button', { name: 'Uncategorized (2)' });
    fireEvent.click(chip);
    await waitFor(() => expect(screen.queryByText('Rent')).not.toBeInTheDocument());
    fireEvent.click(chip);
    expect(await screen.findByText('Rent')).toBeInTheDocument();
  });

  // An always-on "Uncategorized (0)" would be a permanent nag for work
  // already done.
  it('offers no filter once nothing is uncategorized', async () => {
    renderList({
      transactions: { items: [ROWS[0]], save: vi.fn(), remove: vi.fn() },
    });
    expect(await screen.findByText('Rent')).toBeInTheDocument();
    expect(screen.queryByText(/Uncategorized/)).not.toBeInTheDocument();
  });
});
