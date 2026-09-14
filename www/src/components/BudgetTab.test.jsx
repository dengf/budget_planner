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
    new_id: () => 'new-id',
  };
}

const CATEGORIES = [
  { id: 'salary', name: 'Salary', group: 'Income', is_income: true },
  { id: 'food', name: 'Food', group: 'Living', is_income: false },
];

function renderBudget(props) {
  return render(
    <I18nProvider initialLocale="en">
      <BudgetTab
        wasmModule={makeWasm()}
        currencySymbol="$"
        today="2026-01-15"
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

  it('shows the empty state pointing at More once every category is removed', async () => {
    renderBudget({ categories: { items: [] } });
    expect(
      await screen.findByText(
        'No categories yet — add your first one from More → Categories, starting with income.',
      ),
    ).toBeInTheDocument();
  });
});
