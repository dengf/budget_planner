import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import DashboardTab from './DashboardTab';

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

  it('navigates to Transactions for the logTransaction step', async () => {
    const onNavigateTab = vi.fn();
    renderDashboard({
      wasmModule: makeWasm({ income: 1000, total_planned: 1000, unassigned: 0 }),
      onNavigateTab,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Log a transaction' }));
    expect(onNavigateTab).toHaveBeenCalledWith('transactions');
  });
});
