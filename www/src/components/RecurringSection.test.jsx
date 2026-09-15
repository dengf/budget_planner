import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import RecurringSection from './RecurringSection';

const RENT = {
  id: 'r1',
  description: 'Rent',
  category_id: 'housing',
  amount: 500,
  cadence: 'monthly',
  anchor_date: '2026-09-01',
};
const PHONE = {
  id: 'r2',
  description: 'Phone',
  category_id: 'utilities',
  amount: 40,
  cadence: 'monthly',
  anchor_date: '2026-09-15',
};

function occurrenceFor(r) {
  return {
    recurring_id: r.id,
    category_id: r.category_id,
    description: r.description,
    amount: r.amount,
    date: r.anchor_date,
  };
}

/**
 * Behaves like `match_occurrences` and `payment_for_occurrence`: same
 * category, same magnitude, and the payment it proposes is one the next
 * match would recognise. The matching rule itself (including the +/-3
 * day window and one transaction never settling two occurrences) is
 * tested in Rust; what matters here is that the screen asks for it
 * rather than deciding for itself.
 */
const WASM = {
  recurring_status: async ({ recurring, transactions }) => {
    const statuses = recurring.map((r) => {
      const hit = transactions.find(
        (tx) => tx.category_id === r.category_id && Math.abs(tx.amount) === r.amount,
      );
      return { occurrence: occurrenceFor(r), paid: !!hit, transaction_id: hit?.id ?? null };
    });
    const unpaid = statuses.filter((s) => !s.paid);
    return {
      statuses,
      unpaid_count: unpaid.length,
      unpaid_total: unpaid.reduce((sum, s) => sum + s.occurrence.amount, 0),
      error: null,
    };
  },
  occurrence_payment: async ({ occurrence }) => ({
    date: occurrence.date,
    description: occurrence.description,
    amount: -Math.abs(occurrence.amount),
    category_id: occurrence.category_id,
    error: null,
  }),
};

const CATEGORIES = {
  items: [
    { id: 'housing', name: 'Housing', is_income: false },
    { id: 'utilities', name: 'Utilities', is_income: false },
  ],
};

function renderSection(props = {}) {
  const save = vi.fn(() => Promise.resolve());
  const view = render(
    <I18nProvider initialLocale="en">
      <RecurringSection
        wasmModule={WASM}
        currencySymbol="$"
        confirm={() => Promise.resolve(true)}
        categories={CATEGORIES}
        recurring={{ items: [RENT, PHONE], save: vi.fn(), remove: vi.fn() }}
        transactions={{ items: [], save, remove: vi.fn() }}
        viewMonth="2026-09"
        newId={() => 'new-id'}
        {...props}
      />
    </I18nProvider>,
  );
  return { ...view, save };
}

describe('RecurringSection: what is still due', () => {
  it('counts and totals what has not been paid this month', async () => {
    renderSection();
    expect(await screen.findByText('2 still due — $540.00')).toBeInTheDocument();
  });

  // The schedule used to be a standing declaration nobody checked
  // against reality. A row that has actually been paid has to read as
  // paid, or the list is just the setup table again.
  it('marks an occurrence the month already has a transaction for', async () => {
    renderSection({
      transactions: {
        items: [
          {
            id: 't1',
            date: '2026-09-01',
            description: 'Rent',
            amount: -500,
            category_id: 'housing',
          },
        ],
        save: vi.fn(),
        remove: vi.fn(),
      },
    });
    await screen.findByText('1 still due — $40.00');
    expect(screen.getAllByText('Paid')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Mark as paid' })).toHaveLength(1);
  });

  it('writes the transaction the binding describes, sign included', async () => {
    const { save } = renderSection();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Mark as paid' }))[0]);
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0]).toMatchObject({
      date: '2026-09-01',
      description: 'Rent',
      amount: -500,
      category_id: 'housing',
    });
  });

  it('says so plainly when the month is fully settled', async () => {
    renderSection({
      transactions: {
        items: [
          {
            id: 't1',
            date: '2026-09-01',
            description: 'Rent',
            amount: -500,
            category_id: 'housing',
          },
          {
            id: 't2',
            date: '2026-09-15',
            description: 'Phone',
            amount: -40,
            category_id: 'utilities',
          },
        ],
        save: vi.fn(),
        remove: vi.fn(),
      },
    });
    await screen.findByText('Everything scheduled this month has been paid.');
    expect(screen.queryByRole('button', { name: 'Mark as paid' })).not.toBeInTheDocument();
  });

  it('shows no status list at all when nothing is scheduled', async () => {
    renderSection({ recurring: { items: [], save: vi.fn(), remove: vi.fn() } });
    await screen.findByText('No recurring expenses set up yet.');
    expect(screen.queryByText(/still due/)).not.toBeInTheDocument();
    expect(screen.queryByText('Everything scheduled this month has been paid.')).toBeNull();
  });
});
