import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import DebtTab from './DebtTab';

/**
 * Stands in for the two bindings recording a payment goes through.
 *
 * Deliberately mirrors what `budget_calc::apply_payment` and
 * `signed_amount` actually do rather than returning a fixed object: a
 * thinner fake would let the component pass a test while writing a
 * positive-signed payment, or while storing the old balance -- exactly
 * the class of bug these tests exist to catch. The arithmetic itself is
 * tested in Rust; this only has to behave like it.
 */
const WASM = {
  build_payoff_plan: async () => ({ error: null, order: [], schedule: [], months_to_debt_free: 0 }),
  signed_amount: async ({ magnitude, is_income }) => ({
    amount: is_income ? Math.abs(magnitude) : -Math.abs(magnitude),
    error: null,
  }),
  record_debt_payment: async ({ debt, payment }) => {
    const interest = Math.round(debt.balance * (debt.apr_percent / 100 / 12) * 100) / 100;
    const newBalance = Math.max(Math.round((debt.balance + interest - payment) * 100) / 100, 0);
    return {
      interest,
      principal: Math.round((payment - interest) * 100) / 100,
      new_balance: newBalance,
      paid_off: newBalance === 0,
      covers_interest: payment >= interest,
      overpaid: 0,
      error: null,
    };
  },
};

const DEBT = { id: 'd1', name: 'Card', balance: 1000, apr_percent: 12, min_payment: 100 };

function renderTab(props = {}) {
  const save = vi.fn(() => Promise.resolve());
  const saveTransaction = vi.fn(() => Promise.resolve());
  const view = render(
    <I18nProvider initialLocale="en">
      <DebtTab
        wasmModule={WASM}
        currencySymbol="$"
        newId={() => 'new-id'}
        confirm={() => Promise.resolve(true)}
        debts={{ items: [DEBT], save, remove: vi.fn() }}
        transactions={{ items: [], save: saveTransaction, remove: vi.fn() }}
        {...props}
      />
    </I18nProvider>,
  );
  return { ...view, save, saveTransaction };
}

describe('DebtTab: recording a payment', () => {
  it('opens a payment form prefilled with the minimum payment', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Record a payment' }));
    expect(screen.getByLabelText('Payment to Card')).toHaveValue('100');
  });

  // Both halves or neither. A transaction without the new balance leaves
  // the payoff chart projecting from a number that stopped being true;
  // a new balance without the transaction hides the money leaving the
  // account from every other screen in the app.
  it('logs the transaction and writes the new balance from one action', async () => {
    const { save, saveTransaction } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Record a payment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record it' }));

    await waitFor(() => expect(saveTransaction).toHaveBeenCalled());
    // Negative: money left the account. A magnitude here would show up
    // as income on the Dashboard.
    expect(saveTransaction.mock.calls[0][0]).toMatchObject({
      description: 'Payment to Card',
      amount: -100,
    });
    // 1000 + 10 interest - 100 paid.
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1', balance: 910 }));
  });

  it('reports what the payment achieved, split into principal and interest', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Record a payment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record it' }));
    expect(await screen.findByText(/\$90\.00 off Card, \$10\.00 to interest/)).toBeInTheDocument();
  });

  // The case a frozen balance hides completely: a payment smaller than
  // the month's interest leaves the debt bigger than it started, and the
  // chart alone would just redraw slightly further out.
  it('says so when the payment does not cover the interest', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Record a payment' }));
    fireEvent.change(screen.getByLabelText('Payment to Card'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record it' }));
    expect(await screen.findByText(/the balance went up/)).toBeInTheDocument();
  });

  it('writes nothing when the amount is left empty', async () => {
    const { save, saveTransaction } = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Record a payment' }));
    fireEvent.change(screen.getByLabelText('Payment to Card'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record it' }));
    await waitFor(() => expect(saveTransaction).not.toHaveBeenCalled());
    expect(save).not.toHaveBeenCalled();
  });
});
