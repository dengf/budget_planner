import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import BudgetTab from './BudgetTab';

/**
 * A small stand-in for `budget_calc::build_month`, faithful enough to
 * exercise BudgetTab's own logic (which categories get a line, at what
 * amount) without re-implementing the real allocation math -- that's
 * covered by budget-calc's own Rust tests.
 */
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
    build_month: async ({ planned, spent, income_category_ids }) => {
      const spentMap = Object.fromEntries(spent.map((s) => [s.category_id, s.amount]));
      const lines = planned.map((p) => {
        const spentAmt = spentMap[p.category_id] ?? 0;
        return {
          category_id: p.category_id,
          planned: p.amount,
          spent: spentAmt,
          remaining: p.amount - spentAmt,
        };
      });
      const isIncomeLine = (l) => income_category_ids.includes(l.category_id);
      const income = lines.filter(isIncomeLine).reduce((s, l) => s + l.planned, 0);
      const total_planned = lines
        .filter((l) => !isIncomeLine(l))
        .reduce((s, l) => s + l.planned, 0);
      const total_spent = lines.filter((l) => !isIncomeLine(l)).reduce((s, l) => s + l.spent, 0);
      return {
        lines,
        summary: { income, total_planned, total_spent, unassigned: income - total_planned },
      };
    },
    recurring_occurrences: async () => ({ totals_by_category: [], occurrences: [] }),
    preset_categories: async () => [],
    // Stands in for `budget_calc::resolve_category_name`. Which of its
    // five outcomes a typed name deserves is decided in Rust and tested
    // there; what BudgetTab owns is saving the right record on the right
    // side, so this mock only has to distinguish "already yours" from
    // "new".
    resolve_category_name: async ({ typed, direction, existing }) => {
      const wantsIncome = direction === 'income';
      const match = existing.find(
        (c) => c.is_income === wantsIncome && c.name.toLowerCase() === typed.trim().toLowerCase(),
      );
      if (match) return { outcome: 'existing', category_id: match.id };
      return {
        outcome: 'create',
        name: typed.trim(),
        group_key: direction === 'income' ? 'cat.group.income' : 'cat.group.expense',
      };
    },
    new_id: () => 'new-id',
  };
}

const CATEGORIES = [
  { id: 'salary', name: 'Salary', group: 'Income', is_income: true },
  { id: 'food', name: 'Food', group: 'Living', is_income: false },
];

// `today` is a `YYYY-MM` month, matching what App.jsx passes
// (`currentMonth()`) -- a full date would make `viewMonth < today` true
// for the month on screen and have BudgetTab read the current month as
// history.
function renderBudget(props) {
  return render(
    <I18nProvider initialLocale="en">
      <BudgetTab
        wasmModule={makeWasm()}
        newId={() => 'new-id'}
        currencySymbol="$"
        today="2026-01"
        viewMonth="2026-01"
        categories={{ items: CATEGORIES }}
        transactions={{ items: [] }}
        budgetPlan={{ items: [], save: vi.fn(), remove: vi.fn() }}
        goals={{ items: [] }}
        debts={{ items: [] }}
        recurring={{ items: [] }}
        {...props}
      />
    </I18nProvider>,
  );
}

describe('BudgetTab row list', () => {
  // Regression test for the trap CLAUDE.md documents by name: a category
  // with no saved budget-plan entry yet must still get a row at $0, not
  // disappear until something else creates a plan row for it.
  it('renders every known category at $0 planned rather than filtering on budgetPlan.items', async () => {
    renderBudget();
    expect(await screen.findByRole('button', { name: /Salary/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Food/ })).toBeInTheDocument();
  });

  it('starts the assign banner on "add income" before any income category has a planned amount', async () => {
    renderBudget();
    expect(
      await screen.findByText(
        'Start here — plan how much you expect from each income category below.',
      ),
    ).toBeInTheDocument();
  });

  // The first-run banner points at this screen's own control, so the
  // control has to be here even though the side it belongs to has no rows
  // to hang it off -- which is exactly the state a first-time user lands
  // in. Asserting the banner without the button is how "below" quietly
  // becomes a dead end again.
  it('offers the income add control to a user who has no income category', async () => {
    renderBudget({ categories: { items: [CATEGORIES[1]] } });
    expect(
      await screen.findByText('Add an income category below to get started.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add an income category' })).toBeInTheDocument();
  });

  // Budget rows open the plan sheet; they have never had a "+". The
  // nav bar's centre "+" is the one that logs a transaction.
  it('points at the nav bar for logging a transaction, not a "+" on a row', async () => {
    renderBudget();
    await screen.findByRole('button', { name: /Food/ });
    expect(screen.getByText(/use the \+ in the bar below to log one/)).toBeInTheDocument();
  });

  it('shows "every dollar has a job" once income is fully assigned', async () => {
    renderBudget({
      budgetPlan: {
        items: [
          { id: 'p1', month: '2026-01', category_id: 'salary', planned: 1000 },
          { id: 'p2', month: '2026-01', category_id: 'food', planned: 1000 },
        ],
        save: vi.fn(),
        remove: vi.fn(),
      },
    });
    expect(await screen.findByText('Every dollar has a job.')).toBeInTheDocument();
  });

  it('opens EditPlanSheet on a row tap and saves the typed amount on Save', async () => {
    const save = vi.fn();
    renderBudget({ budgetPlan: { items: [], save, remove: vi.fn() } });

    fireEvent.click(await screen.findByRole('button', { name: /Food/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Food')).toBeInTheDocument();

    const input = within(dialog).getByLabelText('Planned');
    fireEvent.change(input, { target: { value: '250' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ category_id: 'food', month: '2026-01', planned: 250 }),
    );
  });

  // A wholly empty budget used to get a sentence sending it to another
  // screen. Both add buttons already say what there is to do here, and
  // two of them beside a message naming a third place is one direction
  // too many.
  it('answers an empty budget with both add controls rather than a message about More', async () => {
    renderBudget({ categories: { items: [] } });
    expect(
      await screen.findByRole('button', { name: '+ Add an income category' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add an expense category' })).toBeInTheDocument();
    expect(screen.queryByText(/More → Categories/)).not.toBeInTheDocument();
  });
});

describe('BudgetTab category creation', () => {
  /**
   * A real store, not `{ items, save: vi.fn() }`: the row a freshly
   * created category earns only appears if the save actually lands in
   * `items`, and a mock that swallows the record would let this pass
   * while the Budget tab stayed empty after creating something.
   */
  function mountWithStore(initial = []) {
    const saved = [];
    function Harness() {
      const [items, setItems] = React.useState(initial);
      const categories = {
        items,
        save: async (record) => {
          saved.push(record);
          setItems((prev) => [...prev, record]);
        },
      };
      return (
        <I18nProvider initialLocale="en">
          <BudgetTab
            wasmModule={makeWasm()}
            newId={() => 'new-id'}
            currencySymbol="$"
            today="2026-01"
            viewMonth="2026-01"
            categories={categories}
            transactions={{ items: [] }}
            budgetPlan={{ items: [], save: vi.fn(), remove: vi.fn() }}
            goals={{ items: [] }}
            debts={{ items: [] }}
            recurring={{ items: [] }}
          />
        </I18nProvider>
      );
    }
    render(<Harness />);
    return saved;
  }

  it('files a category created under Income on the income side, and gives it a row', async () => {
    const saved = mountWithStore();
    fireEvent.click(await screen.findByRole('button', { name: '+ Add an income category' }));
    fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Freelance' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create “Freelance”' }));

    await vi.waitFor(() =>
      expect(saved).toContainEqual(
        expect.objectContaining({ name: 'Freelance', is_income: true, group: 'Income' }),
      ),
    );
    expect(await screen.findByRole('button', { name: /Freelance/ })).toBeInTheDocument();
  });

  // Same field, other section: the side comes from which button opened it,
  // never from anything the user has to say twice.
  it('files a category created under Expense on the expense side', async () => {
    const saved = mountWithStore();
    fireEvent.click(await screen.findByRole('button', { name: '+ Add an expense category' }));
    fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Vet bills' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create “Vet bills”' }));

    await vi.waitFor(() =>
      expect(saved).toContainEqual(
        expect.objectContaining({ name: 'Vet bills', is_income: false, group: 'Expense' }),
      ),
    );
  });

  // Two open name fields on a 375px column is two things to finish where
  // there was one thing to do.
  it('closes the other section field when the second one opens', async () => {
    mountWithStore();
    fireEvent.click(await screen.findByRole('button', { name: '+ Add an income category' }));
    expect(screen.getAllByLabelText('Category name')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '+ Add an expense category' }));
    expect(screen.getAllByLabelText('Category name')).toHaveLength(1);
  });
});

describe('BudgetTab carry-forward offer', () => {
  function withPreviousPlan(month = '2025-12') {
    return {
      ...makeWasm(),
      previous_plan_month: async () => ({ month }),
      list_budget_plan: async () => [{ id: 'p1', month, category_id: 'food', planned: 600 }],
      carry_plan_forward: async () => ({
        entries: [{ category_id: 'food', planned: 600 }],
        dropped_missing_category: 0,
        dropped_zero: 0,
      }),
    };
  }

  it('offers the previous month plan while this month has none of its own', async () => {
    renderBudget({ wasmModule: withPreviousPlan() });
    expect(await screen.findByText("Start from December 2025's plan")).toBeInTheDocument();
  });

  it('writes the carried rows against the month on screen', async () => {
    const save = vi.fn(async () => ({ id: 'new-id' }));
    renderBudget({
      wasmModule: withPreviousPlan(),
      budgetPlan: { items: [], save, remove: vi.fn() },
    });
    fireEvent.click(await screen.findByText("Start from December 2025's plan"));
    await vi.waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        id: 'new-id',
        month: '2026-01',
        category_id: 'food',
        planned: 600,
      }),
    );
  });

  // Taking the offer once this month has a plan would overwrite typed
  // work rather than save any, so the offer is gone by then.
  it('withdraws the offer once this month has a plan of its own', async () => {
    renderBudget({
      wasmModule: withPreviousPlan(),
      budgetPlan: {
        items: [
          { id: 'p1', month: '2026-01', category_id: 'salary', planned: 1000 },
          { id: 'p2', month: '2026-01', category_id: 'food', planned: 400 },
        ],
        save: vi.fn(),
        remove: vi.fn(),
      },
    });
    await screen.findByRole('button', { name: /Food/ });
    expect(screen.queryByText("Start from December 2025's plan")).not.toBeInTheDocument();
  });

  it('never offers to re-plan a month that has already ended', async () => {
    renderBudget({ wasmModule: withPreviousPlan('2025-11'), viewMonth: '2025-12' });
    await screen.findByRole('button', { name: /Food/ });
    expect(screen.queryByText("Start from November 2025's plan")).not.toBeInTheDocument();
  });
});
