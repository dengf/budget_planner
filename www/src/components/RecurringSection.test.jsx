import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

/**
 * The inline batch form desktop gets instead of reaching for "+". The
 * phone is the `useIsDesktop() === false` default every case above
 * renders, and the last one here checks the form stays off it.
 */
describe('RecurringSection: adding on desktop', () => {
  // jsdom has no matchMedia, so `useIsDesktop` reports a phone unless a
  // test says otherwise -- which is what keeps every case above on the
  // list-only screen.
  const mockDesktop = () => {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  };

  afterEach(() => {
    delete window.matchMedia;
  });

  const fillRow = (n, { description, category = 'housing', amount, date }) => {
    fireEvent.change(screen.getByLabelText(`Description, row ${n}`), {
      target: { value: description },
    });
    fireEvent.change(screen.getByLabelText(`Category, row ${n}`), { target: { value: category } });
    fireEvent.change(screen.getByLabelText(`Amount per occurrence, row ${n}`), {
      target: { value: amount },
    });
    fireEvent.change(screen.getByLabelText(`One real due date, row ${n}`), {
      target: { value: date },
    });
  };

  it('offers the rows on the screen itself, with no modal to open first', async () => {
    mockDesktop();
    renderSection();
    expect(await screen.findByLabelText('Description, row 1')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('saves every complete row in one submit', async () => {
    mockDesktop();
    const recurring = { items: [RENT], save: vi.fn(), remove: vi.fn() };
    renderSection({ recurring });

    fillRow(1, { description: 'Insurance', amount: '180', date: '2026-10-03' });
    fillRow(2, {
      description: 'Broadband',
      category: 'utilities',
      amount: '65',
      date: '2026-10-11',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add 2 recurring expenses' }));

    await waitFor(() => expect(recurring.save).toHaveBeenCalledTimes(2));
    expect(recurring.save).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Insurance',
        amount: 180,
        category_id: 'housing',
        cadence: 'monthly',
        anchor_date: '2026-10-03',
      }),
    );
    expect(recurring.save).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Broadband', category_id: 'utilities', amount: 65 }),
    );
  });

  // Nothing to close here, so a clean batch just leaves empty rows
  // ready for the next one -- and an unfinished row stays put either
  // way, rather than being saved or silently dropped.
  it('clears saved rows and keeps an unfinished one', async () => {
    mockDesktop();
    const recurring = { items: [RENT], save: vi.fn(), remove: vi.fn() };
    renderSection({ recurring });

    fillRow(1, { description: 'Insurance', amount: '180', date: '2026-10-03' });
    fireEvent.change(screen.getByLabelText('Description, row 2'), { target: { value: 'Gym' } });

    fireEvent.click(screen.getByRole('button', { name: 'Add recurring expense' }));

    await waitFor(() => expect(recurring.save).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Description, row 1')).toHaveValue('Gym');
    expect(screen.getByLabelText('Description, row 2')).toHaveValue('');
  });

  it('keeps the submit disabled until a row has every field', async () => {
    mockDesktop();
    renderSection();
    const submit = await screen.findByRole('button', { name: 'Add recurring expense' });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Description, row 1'), { target: { value: 'Gym' } });
    fireEvent.change(screen.getByLabelText('Amount per occurrence, row 1'), {
      target: { value: '60' },
    });
    expect(submit).toBeDisabled(); // no category, no due date yet

    fireEvent.change(screen.getByLabelText('Category, row 1'), { target: { value: 'housing' } });
    fireEvent.change(screen.getByLabelText('One real due date, row 1'), {
      target: { value: '2026-10-15' },
    });
    expect(submit).toBeEnabled();
  });

  it('adds a row on Shift+Enter', async () => {
    mockDesktop();
    renderSection();
    fireEvent.keyDown(await screen.findByLabelText('Description, row 1'), {
      key: 'Enter',
      shiftKey: true,
    });
    expect(screen.getByLabelText('Description, row 2')).toHaveFocus();
  });

  it('shows the rows on an empty screen, under the empty state', async () => {
    mockDesktop();
    renderSection({ recurring: { items: [], save: vi.fn(), remove: vi.fn() } });
    expect(await screen.findByText('No recurring expenses set up yet.')).toBeInTheDocument();
    expect(screen.getByLabelText('Description, row 1')).toBeInTheDocument();
  });

  it('leaves the phone reaching for the "+" instead', async () => {
    renderSection();
    await screen.findByText('The schedule');
    expect(screen.queryByLabelText('Description, row 1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add recurring expense' })).not.toBeInTheDocument();
  });
});
