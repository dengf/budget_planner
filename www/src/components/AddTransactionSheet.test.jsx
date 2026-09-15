import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import AddTransactionSheet from './AddTransactionSheet';

const CATEGORIES = {
  items: [
    { id: 'inc1', name: 'Primary Earned Income', is_income: true },
    { id: 'exp1', name: 'Housing', is_income: false },
  ],
};

/**
 * Stands in for the three bindings this sheet calls on the amount and
 * the rule keyword, mirroring what `budget-calc` does -- the real rules
 * (rounding, the zero case, the trimming heuristic) are tested in Rust,
 * and duplicating them here would just be the second implementation
 * those bindings exist to prevent.
 */
const WASM = {
  split_amount: async (amount) => ({
    magnitude: Math.abs(amount),
    is_income: amount > 0,
    error: null,
  }),
  signed_amount: async ({ magnitude, is_income }) => ({
    amount: is_income ? Math.abs(magnitude) : -Math.abs(magnitude),
    error: null,
  }),
  suggest_rule_keyword: async ({ description }) => ({
    keyword: description.split(/\s+/)[0]?.toLowerCase() || null,
    error: null,
  }),
};

function renderSheet(props) {
  const transactions = { items: [], save: vi.fn() };
  const utils = render(
    <I18nProvider initialLocale="en">
      <AddTransactionSheet
        open
        onClose={() => {}}
        wasmModule={WASM}
        newId={() => 'new-id'}
        today="2026-01-01"
        categories={CATEGORIES}
        rules={{ items: [] }}
        transactions={transactions}
        recurring={{ items: [] }}
        formatMoney={(n) => `$${n}`}
        {...props}
      />
    </I18nProvider>,
  );
  return { ...utils, transactions };
}

describe('AddTransactionSheet manual entry', () => {
  // The chips are the category picker now; a dropdown listing every
  // category cost three interactions for the app's most common action.
  it('defaults to Expense mode with only expense categories offered', () => {
    renderSheet();
    expect(screen.getByRole('tab', { name: 'Expense' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Housing' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Primary Earned Income' })).not.toBeInTheDocument();
  });

  it('switches to Income mode and offers only income categories', () => {
    renderSheet();
    fireEvent.click(screen.getByRole('tab', { name: 'Income' }));
    expect(screen.getByRole('button', { name: 'Primary Earned Income' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Housing' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add income' })).toBeInTheDocument();
  });

  it('saves an expense as a negative amount from a plain positive input', async () => {
    const { transactions } = renderSheet();
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-01-05' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Rent' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Housing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add $500 to Housing' }));
    await waitFor(() =>
      expect(transactions.save).toHaveBeenCalledWith(
        expect.objectContaining({ amount: -500, category_id: 'exp1' }),
      ),
    );
  });

  it('saves income as a positive amount from the same plain positive input', async () => {
    const { transactions } = renderSheet();
    fireEvent.click(screen.getByRole('tab', { name: 'Income' }));
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-01-05' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Paycheck' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Primary Earned Income' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add $500 to Primary Earned Income' }));
    await waitFor(() =>
      expect(transactions.save).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 500, category_id: 'inc1' }),
      ),
    );
  });

  // The amount is the one thing someone always knows when they open the
  // sheet. Requiring a date and a note as well put three fields between
  // them and logging the coffee they just bought.
  it('needs only an amount: the date falls back to today and the note to the category', async () => {
    const { transactions } = renderSheet();
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '4.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Housing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add $4.5 to Housing' }));
    await waitFor(() =>
      expect(transactions.save).toHaveBeenCalledWith(
        expect.objectContaining({ date: '2026-01-01', description: 'Housing', amount: -4.5 }),
      ),
    );
  });

  it('will not submit without an amount', () => {
    renderSheet();
    expect(screen.getByRole('button', { name: 'Add expense' })).toBeDisabled();
  });

  // Tapping the selected chip clears it: an uncategorized transaction is
  // an honest record, and better than a wrong one filed to get out of
  // the sheet.
  it('saves without a category when none is chosen', async () => {
    const { transactions } = renderSheet();
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Housing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Housing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add $12' }));
    await waitFor(() =>
      expect(transactions.save).toHaveBeenCalledWith(
        expect.objectContaining({ category_id: null, description: 'Expense' }),
      ),
    );
  });

  it('opens on the requested method rather than always Manual', () => {
    renderSheet({ initialMethod: 'csv' });
    expect(screen.getByRole('tab', { name: 'Import CSV' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('offers a Voice tab that shows the mic control without touching the microphone until tapped', () => {
    renderSheet();
    fireEvent.click(screen.getByRole('tab', { name: 'Voice' }));
    expect(screen.getByRole('button', { name: 'Tap to speak' })).toBeInTheDocument();
  });
});

const EDITING = {
  id: 'tx1',
  date: '2026-01-05',
  description: 'STARBUCKS #4021 SINGAPORE',
  amount: -8.5,
  category_id: 'exp1',
};

describe('AddTransactionSheet editing an existing transaction', () => {
  it('opens on the transaction, with the sign already split off the amount', async () => {
    renderSheet({ editing: EDITING });
    expect(await screen.findByDisplayValue('8.5')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toHaveValue('STARBUCKS #4021 SINGAPORE');
    expect(screen.getByLabelText('Date')).toHaveValue('2026-01-05');
    expect(screen.getByRole('tab', { name: 'Expense' })).toHaveAttribute('aria-selected', 'true');
  });

  // Every other method creates a row; none of them edits this one.
  it('offers no entry methods, since only the manual form can correct a row', async () => {
    renderSheet({ editing: EDITING });
    await screen.findByDisplayValue('8.5');
    expect(screen.queryByRole('tab', { name: 'Import CSV' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Receipt' })).not.toBeInTheDocument();
    expect(screen.getByText('Edit transaction')).toBeInTheDocument();
  });

  // The whole point of an edit: one row corrected, not a near-duplicate
  // left beside the original.
  it('saves over the same id rather than creating a second transaction', async () => {
    const { transactions } = renderSheet({ editing: EDITING });
    await screen.findByDisplayValue('8.5');
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '9.25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(transactions.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tx1', amount: -9.25 }),
      ),
    );
  });

  it('keeps income income when the amount is edited', async () => {
    const { transactions } = renderSheet({
      editing: { ...EDITING, amount: 2400, category_id: 'inc1' },
    });
    // NumberField groups thousands for display; the draft holds 2400.
    await screen.findByDisplayValue('2,400');
    expect(screen.getByRole('tab', { name: 'Income' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(transactions.save).toHaveBeenCalledWith(expect.objectContaining({ amount: 2400 })),
    );
  });

  it('proposes a rule keyword from the description, and lets it be edited before saving', async () => {
    const rules = { items: [], save: vi.fn() };
    renderSheet({ editing: EDITING, rules });
    expect(await screen.findByDisplayValue('starbucks')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Keyword'), { target: { value: 'starbucks sg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    await waitFor(() =>
      expect(rules.save).toHaveBeenCalledWith(
        expect.objectContaining({ keyword: 'starbucks sg', category_id: 'exp1' }),
      ),
    );
    expect(await screen.findByText(/now files under/)).toBeInTheDocument();
  });

  // The picker always has something selected, but on an uncategorized
  // row that is the ranking's suggestion, not an answer. A rule seeded
  // from a guess misfiles every future import, so the offer waits until
  // a category is actually tapped.
  it('waits for a category to be chosen before offering a rule', async () => {
    renderSheet({ editing: { ...EDITING, category_id: null } });
    await screen.findByDisplayValue('8.5');
    expect(screen.queryByText('Make a rule from this')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Housing' }));
    expect(await screen.findByText('Make a rule from this')).toBeInTheDocument();
  });

  it('makes no rule offer when adding a new transaction', () => {
    renderSheet();
    expect(screen.queryByText('Make a rule from this')).not.toBeInTheDocument();
  });
});
