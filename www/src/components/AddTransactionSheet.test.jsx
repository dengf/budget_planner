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
  it('defaults to Expense mode with only expense categories offered', () => {
    renderSheet();
    expect(screen.getByRole('tab', { name: 'Expense' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'Housing' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Primary Earned Income' })).not.toBeInTheDocument();
  });

  it('switches to Income mode and offers only income categories', () => {
    renderSheet();
    fireEvent.click(screen.getByRole('tab', { name: 'Income' }));
    expect(screen.getByRole('option', { name: 'Primary Earned Income' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Housing' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add income' })).toBeInTheDocument();
  });

  it('saves an expense as a negative amount from a plain positive input', () => {
    const { transactions } = renderSheet();
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-01-05' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Rent' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'exp1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add expense' }));
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
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'inc1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add income' }));
    expect(transactions.save).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 500, category_id: 'inc1' }),
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
