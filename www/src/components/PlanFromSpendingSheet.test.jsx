import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import BudgetTab from './BudgetTab';

/**
 * Drives the on-ramp through `BudgetTab`, which owns the offer, the hook
 * and the sheet -- the seam worth testing is "offer to save", not any one
 * of those alone.
 *
 * The `suggest_plan_from_spending` stand-in mirrors the real function's
 * *shape and rules* rather than returning a fixed object: it averages
 * over finished months, rounds expenses up and income down to $5, honours
 * `income_override` by replacing the income side, and turns the leftover
 * into a `__savings__` entry. A thinner fake would let the component pass
 * while writing the observed figures instead of the planned ones, or
 * while dropping the savings row -- exactly what these tests exist to
 * catch. The arithmetic itself is tested in Rust.
 */
const STEP = 5;
const roundUp = (n) => Math.ceil(n / STEP) * STEP;
const roundDown = (n) => (n > 0 && n < STEP ? n : Math.floor(n / STEP) * STEP);

function suggestPlan({ transactions, categories, plan_month, income_override }) {
  const known = new Set(categories.map((c) => c.id));
  const incomeIds = new Set(categories.filter((c) => c.is_income).map((c) => c.id));
  const filed = transactions.filter((t) => t.category_id && known.has(t.category_id));
  const uncategorized = transactions.length - filed.length;

  const complete = filed.filter((t) => t.date.slice(0, 7) < plan_month);
  const partial = filed.filter((t) => t.date.slice(0, 7) === plan_month);
  const samples = complete.length > 0 ? complete : partial;
  const basis = complete.length > 0 ? 'complete_months' : 'partial_month';
  const months = [...new Set(samples.map((t) => t.date.slice(0, 7)))];

  if (samples.length < 5) {
    return {
      state: uncategorized >= 5 ? 'needs_categorizing' : 'not_enough_logged',
      basis: null,
      months_observed: months.length,
      transactions_used: samples.length,
      uncategorized,
      rows: [],
      entries: [],
      total_income: 0,
      total_expenses: 0,
      savings: null,
      shortfall: null,
    };
  }

  const totals = {};
  for (const t of samples) {
    const wanted = incomeIds.has(t.category_id) ? t.amount > 0 : t.amount < 0;
    if (!wanted) continue;
    totals[t.category_id] = (totals[t.category_id] ?? 0) + Math.abs(t.amount);
  }
  const build = (ids, round) =>
    Object.entries(totals)
      .filter(([id]) => ids.has(id) === true)
      .map(([category_id, total]) => {
        const observed = total / months.length;
        return {
          category_id,
          observed,
          planned: round(observed),
          is_income: incomeIds.has(category_id),
        };
      })
      .sort((a, b) => b.planned - a.planned);

  let incomeRows = build(incomeIds, roundDown);
  const expenseRows = Object.entries(totals)
    .filter(([id]) => !incomeIds.has(id))
    .map(([category_id, total]) => {
      const observed = total / months.length;
      return { category_id, observed, planned: roundUp(observed), is_income: false };
    })
    .sort((a, b) => b.planned - a.planned);

  if (income_override) {
    incomeRows = [
      {
        category_id: income_override.category_id,
        observed: income_override.planned,
        planned: income_override.planned,
        is_income: true,
      },
    ];
  }

  const total_expenses = expenseRows.reduce((s, r) => s + r.planned, 0);
  if (incomeRows.length === 0) {
    return {
      state: 'no_income_observed',
      basis,
      months_observed: months.length,
      transactions_used: samples.length,
      uncategorized,
      rows: expenseRows,
      entries: [],
      total_income: 0,
      total_expenses,
      savings: null,
      shortfall: null,
    };
  }

  const total_income = incomeRows.reduce((s, r) => s + r.planned, 0);
  const surplus = total_income - total_expenses;
  const rows = [...incomeRows, ...expenseRows];
  const entries = rows.map((r) => ({ category_id: r.category_id, planned: r.planned }));
  if (surplus > 0) entries.push({ category_id: '__savings__', planned: surplus });

  return {
    state: 'ready',
    basis,
    months_observed: months.length,
    transactions_used: samples.length,
    uncategorized,
    rows,
    entries,
    total_income,
    total_expenses,
    savings: surplus > 0 ? surplus : null,
    shortfall: surplus < 0 ? -surplus : null,
  };
}

function makeWasm() {
  return {
    spend_by_category: async ({ transactions }) => {
      const totals = {};
      for (const tx of transactions) {
        if (tx.amount < 0) totals[tx.category_id] = (totals[tx.category_id] ?? 0) + -tx.amount;
      }
      return {
        totals: Object.entries(totals).map(([category_id, amount]) => ({ category_id, amount })),
      };
    },
    income_by_category: async ({ transactions }) => {
      const totals = {};
      for (const tx of transactions) {
        if (tx.amount > 0) totals[tx.category_id] = (totals[tx.category_id] ?? 0) + tx.amount;
      }
      return {
        totals: Object.entries(totals).map(([category_id, amount]) => ({ category_id, amount })),
      };
    },
    build_month: async ({ planned, income_category_ids }) => {
      const lines = planned.map((p) => ({
        category_id: p.category_id,
        planned: p.amount,
        spent: 0,
        remaining: p.amount,
      }));
      const isIncomeLine = (l) => income_category_ids.includes(l.category_id);
      const income = lines.filter(isIncomeLine).reduce((s, l) => s + l.planned, 0);
      const total_planned = lines
        .filter((l) => !isIncomeLine(l))
        .reduce((s, l) => s + l.planned, 0);
      return {
        lines,
        summary: { income, total_planned, total_spent: 0, unassigned: income - total_planned },
      };
    },
    recurring_occurrences: async () => ({ totals_by_category: [], occurrences: [] }),
    suggest_plan_from_spending: async (params) => suggestPlan(params),
    new_id: () => 'new-id',
  };
}

const CATEGORIES = [
  { id: 'salary', name: 'Salary', group: 'Income', is_income: true },
  { id: 'food', name: 'Groceries', group: 'Living', is_income: false },
  { id: 'rent', name: 'Rent', group: 'Home', is_income: false },
];

const SPEND = [
  { id: '1', date: '2026-01-02', description: 'a', amount: -41.1, category_id: 'food' },
  { id: '2', date: '2026-01-06', description: 'b', amount: -38.15, category_id: 'food' },
  { id: '3', date: '2026-01-11', description: 'c', amount: -44.18, category_id: 'food' },
  { id: '4', date: '2026-01-01', description: 'd', amount: -900, category_id: 'rent' },
  { id: '5', date: '2026-01-05', description: 'e', amount: 2000, category_id: 'salary' },
];

function renderBudget(props = {}) {
  const save = vi.fn(() => Promise.resolve());
  const view = render(
    <I18nProvider initialLocale="en">
      <BudgetTab
        wasmModule={makeWasm()}
        currencySymbol="$"
        today="2026-01"
        viewMonth="2026-01"
        categories={{ items: CATEGORIES }}
        transactions={{ items: SPEND }}
        budgetPlan={{ items: [], save, remove: vi.fn() }}
        goals={{ items: [] }}
        debts={{ items: [] }}
        recurring={{ items: [] }}
        {...props}
      />
    </I18nProvider>,
  );
  return { ...view, save };
}

const openSheet = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Build a budget from what/ }));
};

describe('the log-first on-ramp', () => {
  it('offers to build a budget once there is enough logged to read', async () => {
    renderBudget();
    expect(
      await screen.findByRole('button', { name: /Build a budget from what you've spent/ }),
    ).toBeInTheDocument();
  });

  // The offer's whole premise is history. Without it there is nothing to
  // propose, and an offer that opens onto an empty sheet is worse than no
  // offer.
  it('stays quiet when barely anything has been logged', async () => {
    renderBudget({ transactions: { items: SPEND.slice(0, 2) } });
    await screen.findByRole('button', { name: /Groceries/ });
    expect(screen.queryByRole('button', { name: /Build a budget/ })).not.toBeInTheDocument();
  });

  // Once a plan exists the offer would be overwriting work rather than
  // saving it -- the same rule the carry-forward offer follows.
  it('stops offering once the month has a plan of its own', async () => {
    renderBudget({
      budgetPlan: { items: [{ id: 'p1', category_id: 'salary', planned: 2000 }], save: vi.fn() },
    });
    await screen.findByRole('button', { name: /Groceries/ });
    expect(screen.queryByRole('button', { name: /Build a budget/ })).not.toBeInTheDocument();
  });

  it('shows each row its own working, not just the figure it arrived at', async () => {
    renderBudget();
    await openSheet();
    // 41.10 + 38.15 + 44.18 observed, proposed at the next $5 up.
    expect(await screen.findByText('spent $123.43')).toBeInTheDocument();
    expect(screen.getByText('$125.00')).toBeInTheDocument();
  });

  // A running total of a month three days old and a per-month average
  // over finished months are different claims; saying which is which is
  // the difference between a proposal someone can check and a number the
  // app made up.
  it('says the figures are a floor when the only month read is still running', async () => {
    renderBudget();
    await openSheet();
    expect(await screen.findByText(/a floor, not a full month/)).toBeInTheDocument();
  });

  it('names the leftover as the savings target rather than leaving it unexplained', async () => {
    renderBudget();
    await openSheet();
    // 2000 income - (900 rent + 125 food).
    expect(await screen.findByText(/\$975\.00 left over/)).toBeInTheDocument();
  });

  it('writes every proposed row, savings target included, against the month on screen', async () => {
    const { save } = renderBudget();
    await openSheet();
    fireEvent.click(await screen.findByRole('button', { name: 'Use this budget' }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(4));
    const written = save.mock.calls.map(([row]) => [row.category_id, row.planned]);
    expect(written).toEqual([
      ['salary', 2000],
      ['rent', 900],
      ['food', 125],
      ['__savings__', 975],
    ]);
    // The month being planned, not the month the transactions fell in --
    // those happen to match here, but a plan row saved against the wrong
    // month is invisible on every screen.
    expect(save.mock.calls[0][0].month).toBe('2026-01');
  });

  it('says so plainly when the proposal spends more than it earns', async () => {
    renderBudget({
      transactions: {
        items: SPEND.map((t) => (t.category_id === 'salary' ? { ...t, amount: 1000 } : t)),
      },
    });
    await openSheet();
    expect(await screen.findByText(/plans \$25\.00 more than comes in/)).toBeInTheDocument();
  });

  // Someone who only ever logs spending has the one figure history can't
  // supply. Before this the same person was told to go and plan an income
  // they'd already declined to plan twice.
  describe('when nothing has come in', () => {
    const spendOnly = {
      items: [
        ...SPEND.filter((t) => t.category_id !== 'salary'),
        { id: '6', date: '2026-01-12', description: 'f', amount: -30, category_id: 'food' },
        { id: '7', date: '2026-01-13', description: 'g', amount: -25, category_id: 'food' },
      ],
    };

    it('asks for the monthly figure instead of proposing one', async () => {
      renderBudget({ transactions: spendOnly });
      await openSheet();
      expect(await screen.findByText(/What do you earn in a month\?/)).toBeInTheDocument();
    });

    it('will not save a budget with no income in it', async () => {
      const { save } = renderBudget({ transactions: spendOnly });
      await openSheet();
      const apply = await screen.findByRole('button', { name: 'Use this budget' });
      expect(apply).toBeDisabled();
      fireEvent.click(apply);
      expect(save).not.toHaveBeenCalled();
    });

    it('completes the same proposal once the figure is given', async () => {
      const { save } = renderBudget({ transactions: spendOnly });
      await openSheet();
      fireEvent.change(await screen.findByLabelText('Monthly income'), {
        target: { value: '2000' },
      });

      // 900 rent + 140 food (41.10 + 38.15 + 44.18 + 30 + 25 = 178.43,
      // rounded up to 180) -- the typed figure goes back through the same
      // arithmetic rather than being added up here.
      expect(await screen.findByText(/\$920\.00 left over/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Use this budget' }));
      await waitFor(() => expect(save).toHaveBeenCalled());
      expect(save.mock.calls.map(([row]) => row.category_id)).toContain('salary');
    });
  });
});
