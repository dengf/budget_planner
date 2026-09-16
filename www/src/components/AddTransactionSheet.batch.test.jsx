import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import AddTransactionSheet from './AddTransactionSheet';

/**
 * The desktop batch form -- several rows filed in one save.
 *
 * `isDesktop` is a prop rather than a `matchMedia` read inside the sheet
 * precisely so this file can ask for the batch form directly. The
 * companion file (`AddTransactionSheet.test.jsx`) never passes it, which
 * is what makes those tests the proof that the phone form is untouched.
 */

const CATEGORIES = {
  items: [
    { id: 'inc1', name: 'Primary Earned Income', is_income: true },
    { id: 'exp1', name: 'Housing', is_income: false },
    { id: 'exp2', name: 'Food', is_income: false },
  ],
};

const WASM = {
  signed_amount: async ({ magnitude, is_income }) => ({
    amount: is_income ? Math.abs(magnitude) : -Math.abs(magnitude),
    error: null,
  }),
};

let idSeq = 0;

function renderBatch(props) {
  const transactions = { items: [], save: vi.fn() };
  const onClose = vi.fn();
  idSeq = 0;
  const utils = render(
    <I18nProvider initialLocale="en">
      <AddTransactionSheet
        open
        isDesktop
        onClose={onClose}
        wasmModule={WASM}
        newId={() => `new-id-${(idSeq += 1)}`}
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
  return { ...utils, transactions, onClose };
}

const amountIn = (row) => screen.getByLabelText(`Amount, row ${row}`);
const descriptionIn = (row) => screen.getByLabelText(`Description, row ${row}`);
const categoryIn = (row) => screen.getByLabelText(`Category, row ${row}`);
const dateIn = (row) => screen.getByLabelText(`Date, row ${row}`);
const typeIn = (row) => screen.getByLabelText(`Entry type, row ${row}`);

describe('AddTransactionSheet batch entry', () => {
  it('opens on a single empty row rather than an empty screen', () => {
    renderBatch();
    expect(amountIn(1)).toHaveValue('');
    expect(screen.queryByLabelText('Amount, row 2')).not.toBeInTheDocument();
  });

  // The point of the whole form: no trip to "+ Add a row" between
  // entries, and no reopening the sheet.
  it('grows a fresh row as soon as the last one has an amount', () => {
    renderBatch();
    fireEvent.change(amountIn(1), { target: { value: '12' } });
    expect(amountIn(2)).toHaveValue('');
  });

  it('files every filled row in one save, each with its own direction', async () => {
    const { transactions, onClose } = renderBatch();

    fireEvent.change(amountIn(1), { target: { value: '500' } });
    fireEvent.change(descriptionIn(1), { target: { value: 'Rent' } });
    fireEvent.change(categoryIn(1), { target: { value: 'exp1' } });
    fireEvent.change(dateIn(1), { target: { value: '2026-01-05' } });

    fireEvent.change(typeIn(2), { target: { value: 'income' } });
    fireEvent.change(amountIn(2), { target: { value: '3000' } });
    fireEvent.change(descriptionIn(2), { target: { value: 'Paycheck' } });
    fireEvent.change(categoryIn(2), { target: { value: 'inc1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Add 2 transactions' }));

    await waitFor(() => expect(transactions.save).toHaveBeenCalledTimes(2));
    expect(transactions.save).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        amount: -500,
        category_id: 'exp1',
        date: '2026-01-05',
        description: 'Rent',
      }),
    );
    expect(transactions.save).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ amount: 3000, category_id: 'inc1', description: 'Paycheck' }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  // The trailing row is somewhere to type, not a transaction.
  it('ignores the empty row waiting at the bottom', async () => {
    const { transactions } = renderBatch();
    fireEvent.change(amountIn(1), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add $12' }));
    await waitFor(() => expect(transactions.save).toHaveBeenCalledTimes(1));
  });

  it('will not submit with nothing filled in', () => {
    renderBatch();
    expect(screen.getByRole('button', { name: 'Add expense' })).toBeDisabled();
  });

  it('offers only the row’s own side of the ledger', () => {
    renderBatch();
    expect(screen.getByRole('option', { name: 'Housing' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Primary Earned Income' })).not.toBeInTheDocument();

    fireEvent.change(typeIn(1), { target: { value: 'income' } });
    expect(screen.getByRole('option', { name: 'Primary Earned Income' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Housing' })).not.toBeInTheDocument();
  });

  it('drops a removed row from the batch', async () => {
    const { transactions } = renderBatch();
    fireEvent.change(amountIn(1), { target: { value: '10' } });
    fireEvent.change(amountIn(2), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove row 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add $20' }));
    await waitFor(() => expect(transactions.save).toHaveBeenCalledTimes(1));
    expect(transactions.save).toHaveBeenCalledWith(expect.objectContaining({ amount: -20 }));
  });

  // Typing a batch is a keyboard job, so the row break is a keystroke
  // rather than a trip to the button with the mouse.
  it('adds a row on Shift+Enter and puts the caret in it', () => {
    renderBatch();
    fireEvent.change(descriptionIn(1), { target: { value: 'Rent' } });
    fireEvent.keyDown(descriptionIn(1), { key: 'Enter', shiftKey: true });
    expect(amountIn(2)).toHaveValue('');
    expect(amountIn(2)).toHaveFocus();
  });

  // Filling an amount already grows a row underneath; the shortcut has
  // to move into that one rather than strand it above the caret.
  it('moves to the row below instead of adding a second empty one', () => {
    renderBatch();
    fireEvent.change(amountIn(1), { target: { value: '12' } });
    fireEvent.keyDown(descriptionIn(1), { key: 'Enter', shiftKey: true });
    expect(amountIn(2)).toHaveFocus();
    expect(screen.queryByLabelText('Amount, row 3')).not.toBeInTheDocument();
  });

  // Plain Enter is the form's own submit, which is why the shortcut
  // needs the modifier: it must not add a row instead.
  it('leaves plain Enter alone', () => {
    renderBatch();
    fireEvent.keyDown(amountIn(1), { key: 'Enter' });
    expect(screen.queryByLabelText('Amount, row 2')).not.toBeInTheDocument();
  });

  // A new row inherits the date above it: a batch is usually one day's
  // receipts, so the date is set once rather than once per row.
  it('carries the date down to the next row', () => {
    renderBatch();
    fireEvent.change(dateIn(1), { target: { value: '2026-01-05' } });
    fireEvent.change(amountIn(1), { target: { value: '12' } });
    expect(dateIn(2)).toHaveValue('2026-01-05');
  });

  // Correcting a row is one row by definition, and the rule offer lives
  // on that form.
  it('keeps the single form for a correction, even at desktop width', () => {
    renderBatch({
      editing: { id: 't1', date: '2026-01-02', description: 'Rent', amount: -500 },
      wasmModule: {
        ...WASM,
        split_amount: async (amount) => ({
          magnitude: Math.abs(amount),
          is_income: amount > 0,
          error: null,
        }),
        suggest_rule_keyword: async () => ({ keyword: 'rent', error: null }),
      },
    });
    expect(screen.queryByLabelText('Amount, row 1')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Amount')).toBeInTheDocument();
  });
});
