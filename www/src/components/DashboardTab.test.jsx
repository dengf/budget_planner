import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { monthLabel } from '../month';
import DashboardTab from './DashboardTab';

// Mirrors `budget_calc::month_setup_state`'s own rule closely enough for
// a test double -- the real behaviour is covered by that function's own
// Rust tests; this only needs to drive DashboardTab.jsx through each
// branch of its render logic.
function monthSetupState({ is_current_month, has_transactions, income, unassigned }) {
  if (!has_transactions) {
    if (!is_current_month) return 'other_month_empty';
    if (!(income > 0)) return 'setup_plan_income';
    if (unassigned !== 0) return 'setup_assign_remaining';
    return 'setup_log_transaction';
  }
  if (!(income > 0)) return 'spent_so_far';
  if (unassigned !== 0) return 'savings_unassigned';
  return 'savings_complete';
}

function makeWasm({ income = 0, total_planned = 0, unassigned = 0, total_spent = 0 } = {}) {
  return {
    spend_by_category: async () => ({ totals: [] }),
    income_by_category: async () => ({ totals: [] }),
    daily_spend: async () => ({ totals: [] }),
    weekly_spend: async () => ({ totals: [] }),
    build_month: async () => ({
      lines: [],
      summary: { income, total_planned, total_spent, unassigned },
    }),
    build_savings_line: async () => ({ line: { planned: 0, spent: 0 } }),
    goal_progress: async () => ({ petals_filled: 0 }),
    month_setup_state: async (params) => ({ state: monthSetupState(params) }),
    category_shares: async () => ({ shares: [] }),
  };
}

function renderDashboard(props) {
  return render(
    <I18nProvider initialLocale="en">
      <DashboardTab
        wasmModule={makeWasm()}
        currencySymbol="$"
        today="2026-01"
        viewMonth="2026-01"
        setViewMonth={() => {}}
        categories={{ items: [] }}
        transactions={{ items: [] }}
        budgetPlan={{ items: [] }}
        goals={{ items: [] }}
        debts={{ items: [] }}
        onNavigateTab={() => {}}
        {...props}
      />
    </I18nProvider>,
  );
}

describe('DashboardTab setup steps', () => {
  it('asks to plan income when nothing is planned yet', async () => {
    renderDashboard();
    expect(await screen.findByText('Plan your income')).toBeInTheDocument();
    expect(screen.queryByText('Income')).not.toBeInTheDocument();
  });

  it('asks to assign the rest of income once income exists but is unassigned', async () => {
    renderDashboard({ wasmModule: makeWasm({ income: 1000, unassigned: 400 }) });
    expect(await screen.findByText('Assign the rest of your income')).toBeInTheDocument();
  });

  it('asks to log a transaction once fully assigned with no activity this month', async () => {
    renderDashboard({ wasmModule: makeWasm({ income: 1000, total_planned: 1000, unassigned: 0 }) });
    expect(await screen.findByText('Log your first transaction')).toBeInTheDocument();
  });

  it('shows the normal summary once income is assigned and a transaction exists', async () => {
    renderDashboard({
      wasmModule: makeWasm({ income: 1000, total_planned: 1000, unassigned: 0 }),
      transactions: { items: [{ id: 't1', date: '2026-01-05', amount: -20, category_id: 'c1' }] },
    });
    expect(await screen.findByText('Income')).toBeInTheDocument();
    expect(screen.queryByText('Plan your income')).not.toBeInTheDocument();
    expect(screen.queryByText('Log your first transaction')).not.toBeInTheDocument();
  });

  it('navigates to Budget for the planIncome and assignRemaining steps, Transactions for logTransaction', async () => {
    const onNavigateTab = vi.fn();
    renderDashboard({ onNavigateTab });
    fireEvent.click(await screen.findByRole('button', { name: 'Plan income' }));
    expect(onNavigateTab).toHaveBeenCalledWith('budget');
  });

  // This one step opens the Add sheet instead of changing tab: dropping
  // someone on an empty Transactions list leaves them one tap short of
  // what the button just offered to do.
  it('opens the add sheet for the logTransaction step rather than changing tab', async () => {
    const onNavigateTab = vi.fn();
    const onOpenAdd = vi.fn();
    renderDashboard({
      wasmModule: makeWasm({ income: 1000, total_planned: 1000, unassigned: 0 }),
      onNavigateTab,
      onOpenAdd,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Log a transaction' }));
    expect(onOpenAdd).toHaveBeenCalledWith('manual');
    expect(onNavigateTab).not.toHaveBeenCalled();
  });
});

describe('DashboardTab hero states', () => {
  // Regression test for the real, shipped bug this redesign fixes: the
  // setup ladder used to hide every logged transaction for as long as
  // income stayed unplanned. Logging money without planning income must
  // show what was logged, not the ladder.
  it('shows what was spent, not the setup ladder, once transactions exist with no income planned', async () => {
    renderDashboard({
      transactions: { items: [{ id: 't1', date: '2026-01-05', amount: -20, category_id: 'c1' }] },
    });
    expect(await screen.findByText('Spent so far')).toBeInTheDocument();
    expect(screen.queryByText('Plan your income')).not.toBeInTheDocument();
    expect(screen.getByText("Add your income to see what you're saving")).toBeInTheDocument();
  });

  it('shows a link back to the current month, not the ladder, for an empty past month', async () => {
    renderDashboard({ today: '2026-01', viewMonth: '2025-12' });
    expect(
      await screen.findByText(`Nothing recorded in ${monthLabel('2025-12', 'en')}`),
    ).toBeInTheDocument();
    expect(screen.queryByText('Plan your income')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `Back to ${monthLabel('2026-01', 'en')}` }),
    ).toBeInTheDocument();
  });

  it('nudges toward the remaining unassigned amount, with no blossom, while income is unassigned', async () => {
    renderDashboard({
      wasmModule: makeWasm({ income: 1000, unassigned: 400 }),
      transactions: { items: [{ id: 't1', date: '2026-01-05', amount: -20, category_id: 'c1' }] },
    });
    expect(await screen.findByText('$400.00 unassigned')).toBeInTheDocument();
    expect(document.querySelector('.dash-hero-blossom')).not.toBeInTheDocument();
  });

  it('shows the blossom only once income is fully assigned', async () => {
    renderDashboard({
      wasmModule: makeWasm({ income: 1000, total_planned: 1000, unassigned: 0 }),
      transactions: { items: [{ id: 't1', date: '2026-01-05', amount: -20, category_id: 'c1' }] },
    });
    await screen.findByText('Savings');
    expect(document.querySelector('.dash-hero-blossom')).toBeInTheDocument();
  });
});
