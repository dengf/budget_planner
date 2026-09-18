import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

function mockDesktop() {
  window.matchMedia = vi.fn(() => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const debtName = (n) => screen.getByLabelText(`Debt name, row ${n}`);
const debtBalance = (n) => screen.getByLabelText(`Balance, row ${n}`);
const debtApr = (n) => screen.getByLabelText(`APR %, row ${n}`);
const debtMin = (n) => screen.getByLabelText(`Minimum payment, row ${n}`);

function fillDebt(n, { name, balance, min, apr }) {
  fireEvent.change(debtName(n), { target: { value: name } });
  fireEvent.change(debtBalance(n), { target: { value: balance } });
  fireEvent.change(debtMin(n), { target: { value: min } });
  if (apr !== undefined) fireEvent.change(debtApr(n), { target: { value: apr } });
}

describe('DebtTab desktop rows', () => {
  afterEach(() => {
    delete window.matchMedia;
  });

  it('saves every finished row in one submit', async () => {
    mockDesktop();
    let seq = 0;
    const { save } = renderTab({ newId: () => `d-${(seq += 1)}` });
    fillDebt(1, { name: 'Visa', balance: '4000', min: '120', apr: '19.9' });
    fillDebt(2, { name: 'Car loan', balance: '12000', min: '300', apr: '5' });
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 debts' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Visa', balance: 4000, min_payment: 120, apr_percent: 19.9 }),
    );
    const ids = save.mock.calls.map(([d]) => d.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('defaults a blank APR to 0 per row, as the phone form does', async () => {
    mockDesktop();
    let seq = 0;
    const { save } = renderTab({ newId: () => `d-${(seq += 1)}` });
    // An interest-free debt is a real thing (a family loan, a 0% plan),
    // so a blank APR is a value, not an unfinished row.
    fillDebt(1, { name: 'Family loan', balance: '1500', min: '100' });
    fireEvent.click(screen.getByRole('button', { name: 'Add a debt' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ apr_percent: 0 }));
  });

  it('will not submit until a row has a name, a balance and a minimum payment', () => {
    mockDesktop();
    const { save } = renderTab();
    expect(screen.getByRole('button', { name: 'Add a debt' })).toBeDisabled();
    fireEvent.change(debtName(1), { target: { value: 'Visa' } });
    expect(screen.getByRole('button', { name: 'Add a debt' })).toBeDisabled();
    fireEvent.change(debtBalance(1), { target: { value: '4000' } });
    // Still short a minimum payment: without one there is no payoff
    // schedule to draw, which is why the phone form demands it too.
    expect(screen.getByRole('button', { name: 'Add a debt' })).toBeDisabled();
    fireEvent.change(debtMin(1), { target: { value: '120' } });
    expect(screen.getByRole('button', { name: 'Add a debt' })).toBeEnabled();
    expect(save).not.toHaveBeenCalled();
  });

  it('counts only the finished rows in the button', () => {
    mockDesktop();
    renderTab();
    fillDebt(1, { name: 'Visa', balance: '4000', min: '120' });
    fillDebt(2, { name: 'Car loan', balance: '12000', min: '300' });
    fireEvent.change(debtName(3), { target: { value: 'Student loan' } });
    expect(screen.getByRole('button', { name: 'Add 2 debts' })).toBeInTheDocument();
  });

  it('keeps a half-finished row after saving the finished ones', async () => {
    mockDesktop();
    let seq = 0;
    const { save } = renderTab({ newId: () => `d-${(seq += 1)}` });
    fillDebt(1, { name: 'Visa', balance: '4000', min: '120' });
    fireEvent.change(debtName(2), { target: { value: 'Student loan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add a debt' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(debtName(1)).toHaveValue('Student loan'));
    expect(debtName(2)).toHaveValue('');
  });

  it('adds a row on Shift+Enter and puts the caret in its name field', async () => {
    mockDesktop();
    renderTab();
    fireEvent.keyDown(debtName(1), { key: 'Enter', shiftKey: true });
    await waitFor(() => expect(debtName(2)).toBeInTheDocument());
    expect(debtName(2)).toHaveFocus();
  });

  it('grows a fresh row once a name is typed in the last one', () => {
    mockDesktop();
    renderTab();
    expect(screen.queryByLabelText('Debt name, row 2')).not.toBeInTheDocument();
    fireEvent.change(debtName(1), { target: { value: 'Visa' } });
    expect(debtName(2)).toBeInTheDocument();
  });

  it('groups a five-figure balance at rest, as the phone form does', () => {
    mockDesktop();
    renderTab();
    fireEvent.change(debtBalance(1), { target: { value: '12400' } });
    fireEvent.blur(debtBalance(1));
    expect(debtBalance(1)).toHaveValue('12,400');
  });
});

describe('DebtTab on the phone shell', () => {
  afterEach(() => {
    delete window.matchMedia;
  });

  // window.matchMedia is left unmocked, matching this codebase's default
  // "phone shell" behaviour (see useIsDesktop.js).
  it('keeps the single draft form, which is what fits 375px', () => {
    renderTab();
    expect(screen.getByLabelText('Debt name')).toBeInTheDocument();
    expect(screen.queryByLabelText('Debt name, row 1')).not.toBeInTheDocument();
  });

  it('hides the row shortcut hint, since there are no rows here', () => {
    renderTab();
    expect(screen.queryByText('Shift + Enter adds a row')).not.toBeInTheDocument();
  });
});
