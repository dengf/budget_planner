import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import AddTransactionSheet from './AddTransactionSheet';

const CATEGORIES = {
  items: [
    { id: 'inc1', name: 'Primary Earned Income', is_income: true },
    { id: 'exp1', name: 'Housing', is_income: false },
  ],
};

function renderSheet(props) {
  const transactions = { items: [], save: vi.fn() };
  const utils = render(
    <I18nProvider initialLocale="en">
      <AddTransactionSheet
        open
        onClose={() => {}}
        wasmModule={{}}
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

  it('saves an expense as a negative amount from a plain positive input', () => {
    const { transactions } = renderSheet();
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-01-05' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Rent' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Housing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add $500 to Housing' }));
    expect(transactions.save).toHaveBeenCalledWith(
      expect.objectContaining({ amount: -500, category_id: 'exp1' }),
    );
  });

  it('saves income as a positive amount from the same plain positive input', () => {
    const { transactions } = renderSheet();
    fireEvent.click(screen.getByRole('tab', { name: 'Income' }));
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-01-05' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Paycheck' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Primary Earned Income' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add $500 to Primary Earned Income' }));
    expect(transactions.save).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 500, category_id: 'inc1' }),
    );
  });

  // The amount is the one thing someone always knows when they open the
  // sheet. Requiring a date and a note as well put three fields between
  // them and logging the coffee they just bought.
  it('needs only an amount: the date falls back to today and the note to the category', () => {
    const { transactions } = renderSheet();
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '4.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Housing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add $4.5 to Housing' }));
    expect(transactions.save).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-01-01', description: 'Housing', amount: -4.5 }),
    );
  });

  it('will not submit without an amount', () => {
    renderSheet();
    expect(screen.getByRole('button', { name: 'Add expense' })).toBeDisabled();
  });

  // Tapping the selected chip clears it: an uncategorized transaction is
  // an honest record, and better than a wrong one filed to get out of
  // the sheet.
  it('saves without a category when none is chosen', () => {
    const { transactions } = renderSheet();
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Housing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Housing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add $12' }));
    expect(transactions.save).toHaveBeenCalledWith(
      expect.objectContaining({ category_id: null, description: 'Expense' }),
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
