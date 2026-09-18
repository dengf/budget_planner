import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import GoalsTab from './GoalsTab';

/**
 * Behaves like the bindings this screen goes through, not like a fixed
 * answer. `goal_contribution` in particular has to return the *whole*
 * updated goal -- balance and month ledger together -- because storing
 * only one of the two is the bug that lets one month's savings be
 * allocated twice. A fake that returned just a number could not catch
 * that.
 */
const WASM = {
  goal_progress: async () => ({ petals_filled: 1, ratio: 0.2, error: null }),
  required_contribution: async () => ({ amount: 100, error: null }),
  spend_by_category: async () => ({ totals: [{ category_id: 'exp1', amount: 200 }] }),
  income_by_category: async () => ({ totals: [{ category_id: 'inc1', amount: 1000 }] }),
  build_month: async () => ({
    lines: [
      { category_id: 'inc1', planned: 1000, rollover: 0, spent: 1000, remaining: 0 },
      { category_id: 'exp1', planned: 300, rollover: 0, spent: 200, remaining: 100 },
    ],
    summary: { income: 1000, total_planned: 300, total_spent: 200, unassigned: 700, unspent: 100 },
    error: null,
  }),
  // Income minus every real expense category's actual: 1000 - 200.
  build_savings_line: async ({ income, total_expense_actual }) => ({
    line: {
      category_id: '__savings__',
      planned: 0,
      rollover: 0,
      spent: income - total_expense_actual,
      remaining: 0,
    },
    error: null,
  }),
  // `state` as well as the amount, mirroring
  // `budget_calc::savings_allocation_state`: two of its four cases leave
  // the amount at zero, so a fake that returned only the number could
  // not tell "all assigned" from "more assigned than the month saved".
  unallocated_savings: async ({ savings_actual, goals, month }) => {
    const allocated = goals
      .flatMap((g) => g.contributions ?? [])
      .filter((c) => c.month === month)
      .reduce((sum, c) => sum + c.amount, 0);
    let state;
    if (savings_actual <= 0) state = allocated > 0 ? 'over_allocated' : 'nothing_saved';
    else if (allocated < savings_actual) state = 'unallocated';
    else if (allocated === savings_actual) state = 'fully_allocated';
    else state = 'over_allocated';
    return { amount: Math.max(savings_actual - allocated, 0), allocated, state, error: null };
  },
  goal_contribution: async ({ goal, month, amount }) => ({
    goal: {
      ...goal,
      current_amount: goal.current_amount + amount,
      contributions: [...(goal.contributions ?? []), { month, amount }],
    },
    milestone: null,
    error: null,
  }),
};

const CATEGORIES = {
  items: [
    { id: 'inc1', name: 'Salary', is_income: true },
    { id: 'exp1', name: 'Housing', is_income: false },
  ],
};

const GOAL = {
  id: 'g1',
  name: 'Trip',
  target_amount: 5000,
  current_amount: 1000,
  target_date: '2027-06-01',
  cadence: 'monthly',
  contributions: [],
};

function renderTab(props = {}) {
  const save = vi.fn(() => Promise.resolve());
  const view = render(
    <I18nProvider initialLocale="en">
      <GoalsTab
        wasmModule={WASM}
        currencySymbol="$"
        newId={() => 'new-id'}
        confirm={() => Promise.resolve(true)}
        goals={{ items: [GOAL], save, remove: vi.fn() }}
        transactions={{ items: [], save: vi.fn(), remove: vi.fn() }}
        categories={CATEGORIES}
        budgetPlan={{ items: [] }}
        viewMonth="2026-09"
        {...props}
      />
    </I18nProvider>,
  );
  return { ...view, save };
}

describe('GoalsTab: this month’s savings', () => {
  it('says how much of the month’s savings no goal has claimed', async () => {
    renderTab();
    expect(
      await screen.findByText('September 2026 saved $800.00 that no goal has claimed yet.'),
    ).toBeInTheDocument();
  });

  it('offers a one-tap add for that amount', async () => {
    renderTab();
    expect(
      await screen.findByRole('button', { name: "Add September 2026's $800.00" }),
    ).toBeInTheDocument();
  });

  // The whole goal comes back from the binding, ledger included. Saving
  // only the new balance would leave the month looking unallocated, and
  // the same $800 could be added to a second goal.
  it('stores the new balance and the month it was credited to together', async () => {
    const { save } = renderTab();
    fireEvent.click(await screen.findByRole('button', { name: "Add September 2026's $800.00" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0]).toMatchObject({
      id: 'g1',
      current_amount: 1800,
      contributions: [{ month: '2026-09', amount: 800 }],
    });
  });

  it('routes a typed amount through the same call, not JS arithmetic', async () => {
    const { save } = renderTab();
    fireEvent.change(screen.getByLabelText('Add to Trip'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0]).toMatchObject({
      current_amount: 1250,
      contributions: [{ month: '2026-09', amount: 250 }],
    });
  });

  // "All of it is assigned" on a month that saved nothing is a success
  // message on an empty state -- the thing CLAUDE.md ranks with a
  // miscalculation.
  it('does not claim the savings are all assigned when there were none', async () => {
    renderTab({
      wasmModule: {
        ...WASM,
        build_savings_line: async () => ({
          line: { category_id: '__savings__', planned: 0, rollover: 0, spent: 0, remaining: 0 },
          error: null,
        }),
      },
    });
    await screen.findByText('September 2026 has no savings to assign yet.');
    expect(screen.queryByRole('button', { name: /^Add September/ })).not.toBeInTheDocument();
  });

  // Assign first, log more spending afterwards, and the month turns out
  // to have saved less than went into the goal. "All of it is assigned"
  // would be a confident wrong number about a figure the user can check.
  it('says the month was over-assigned rather than claiming it balanced', async () => {
    renderTab({
      goals: {
        items: [{ ...GOAL, contributions: [{ month: '2026-09', amount: 800 }] }],
        save: vi.fn(),
        remove: vi.fn(),
      },
      wasmModule: {
        ...WASM,
        build_savings_line: async () => ({
          line: { category_id: '__savings__', planned: 0, rollover: 0, spent: 500, remaining: 0 },
          error: null,
        }),
      },
    });
    expect(
      await screen.findByText(
        '$800.00 is assigned to goals from September 2026, but the month only saved $500.00 \u2014 spending logged since put it over.',
      ),
    ).toBeInTheDocument();
  });

  it('once every dollar is claimed, offers no second add for the same month', async () => {
    renderTab({
      goals: {
        items: [{ ...GOAL, contributions: [{ month: '2026-09', amount: 800 }] }],
        save: vi.fn(),
        remove: vi.fn(),
      },
    });
    await screen.findByText("All $800.00 of September 2026's savings is assigned to a goal.");
    expect(screen.queryByRole('button', { name: /^Add September/ })).not.toBeInTheDocument();
  });
});

function mockDesktop() {
  window.matchMedia = vi.fn(() => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const goalName = (n) => screen.getByLabelText(`Goal name, row ${n}`);
const goalTarget = (n) => screen.getByLabelText(`Target amount, row ${n}`);
const goalDate = (n) => screen.getByLabelText(`Target date, row ${n}`);
const goalCadence = (n) => screen.getByLabelText(`Contribute, row ${n}`);

function fillGoal(n, { name, target, date }) {
  fireEvent.change(goalName(n), { target: { value: name } });
  fireEvent.change(goalTarget(n), { target: { value: target } });
  fireEvent.change(goalDate(n), { target: { value: date } });
}

describe('GoalsTab desktop rows', () => {
  afterEach(() => {
    delete window.matchMedia;
  });

  it('saves every finished row in one submit', async () => {
    mockDesktop();
    let seq = 0;
    const { save } = renderTab({ newId: () => `g-${(seq += 1)}` });
    fillGoal(1, { name: 'Emergency fund', target: '10000', date: '2027-01-01' });
    fillGoal(2, { name: 'Laptop', target: '2000', date: '2027-03-01' });
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 goals' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Emergency fund',
        target_amount: 10000,
        target_date: '2027-01-01',
        // A new goal starts empty with no ledger, whichever shape made
        // it -- both go through the same `saveGoal`.
        current_amount: 0,
        contributions: [],
        cadence: 'monthly',
      }),
    );
    const ids = save.mock.calls.map(([g]) => g.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('carries a per-row cadence, not one choice for the whole form', async () => {
    mockDesktop();
    let seq = 0;
    const { save } = renderTab({ newId: () => `g-${(seq += 1)}` });
    fillGoal(1, { name: 'Emergency fund', target: '10000', date: '2027-01-01' });
    fillGoal(2, { name: 'Laptop', target: '2000', date: '2027-03-01' });
    fireEvent.change(goalCadence(2), { target: { value: 'weekly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 goals' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    const cadences = Object.fromEntries(save.mock.calls.map(([g]) => [g.name, g.cadence]));
    expect(cadences).toEqual({ 'Emergency fund': 'monthly', Laptop: 'weekly' });
  });

  it('will not submit until a row has a name, a target and a date', () => {
    mockDesktop();
    const { save } = renderTab();
    expect(screen.getByRole('button', { name: 'Add a goal' })).toBeDisabled();
    fireEvent.change(goalName(1), { target: { value: 'Trip' } });
    expect(screen.getByRole('button', { name: 'Add a goal' })).toBeDisabled();
    fireEvent.change(goalTarget(1), { target: { value: '3000' } });
    // Still short a date: the required contribution is meaningless
    // without one, which is why the phone form demands it too.
    expect(screen.getByRole('button', { name: 'Add a goal' })).toBeDisabled();
    fireEvent.change(goalDate(1), { target: { value: '2027-01-01' } });
    expect(screen.getByRole('button', { name: 'Add a goal' })).toBeEnabled();
    expect(save).not.toHaveBeenCalled();
  });

  it('counts only the finished rows in the button', () => {
    mockDesktop();
    renderTab();
    fillGoal(1, { name: 'Emergency fund', target: '10000', date: '2027-01-01' });
    fillGoal(2, { name: 'Laptop', target: '2000', date: '2027-03-01' });
    fireEvent.change(goalName(3), { target: { value: 'Car' } });
    expect(screen.getByRole('button', { name: 'Add 2 goals' })).toBeInTheDocument();
  });

  it('keeps a half-finished row after saving the finished ones', async () => {
    mockDesktop();
    let seq = 0;
    const { save } = renderTab({ newId: () => `g-${(seq += 1)}` });
    fillGoal(1, { name: 'Emergency fund', target: '10000', date: '2027-01-01' });
    fireEvent.change(goalName(2), { target: { value: 'Car' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add a goal' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(goalName(1)).toHaveValue('Car'));
    expect(goalName(2)).toHaveValue('');
  });

  it('adds a row on Shift+Enter and puts the caret in its name field', async () => {
    mockDesktop();
    renderTab();
    fireEvent.keyDown(goalName(1), { key: 'Enter', shiftKey: true });
    await waitFor(() => expect(goalName(2)).toBeInTheDocument());
    expect(goalName(2)).toHaveFocus();
  });

  it('grows a fresh row once a name is typed in the last one', () => {
    mockDesktop();
    renderTab();
    expect(screen.queryByLabelText('Goal name, row 2')).not.toBeInTheDocument();
    fireEvent.change(goalName(1), { target: { value: 'Trip' } });
    expect(goalName(2)).toBeInTheDocument();
  });

  it('groups a five-figure target at rest, as the phone form does', () => {
    mockDesktop();
    renderTab();
    fireEvent.change(goalTarget(1), { target: { value: '25000' } });
    fireEvent.blur(goalTarget(1));
    expect(goalTarget(1)).toHaveValue('25,000');
  });
});

describe('GoalsTab on the phone shell', () => {
  afterEach(() => {
    delete window.matchMedia;
  });

  // window.matchMedia is left unmocked, matching this codebase's default
  // "phone shell" behaviour (see useIsDesktop.js).
  it('keeps the single draft form, which is what fits 375px', () => {
    renderTab();
    expect(screen.getByLabelText('Goal name')).toBeInTheDocument();
    expect(screen.queryByLabelText('Goal name, row 1')).not.toBeInTheDocument();
  });

  it('hides the row shortcut hint, since there are no rows here', () => {
    renderTab();
    expect(screen.queryByText('Shift + Enter adds a row')).not.toBeInTheDocument();
  });
});
