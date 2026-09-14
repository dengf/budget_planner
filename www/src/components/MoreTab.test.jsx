import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import MoreTab from './MoreTab';

const dataset = () => ({ items: [], save: vi.fn(), remove: vi.fn() });

function renderMore(props) {
  return render(
    <I18nProvider initialLocale="en">
      <MoreTab
        wasmModule={{}}
        currencySymbol="$"
        today="2026-01-01"
        viewMonth="2026-01-01"
        newId={() => 'new-id'}
        confirm={() => Promise.resolve(true)}
        categories={dataset()}
        transactions={dataset()}
        rules={dataset()}
        recurring={dataset()}
        goals={dataset()}
        debts={dataset()}
        budgetPlan={dataset()}
        {...props}
      />
    </I18nProvider>,
  );
}

describe('MoreTab', () => {
  it('lists the four things that used to be tabs or buried disclosures', () => {
    renderMore();
    for (const name of [
      'Savings goals',
      'Debt payoff',
      'Categorization rules',
      'Recurring expenses',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeInTheDocument();
    }
  });

  // The list swaps itself for the section rather than expanding in place:
  // four full panels on one scroll is what this screen exists to avoid.
  it('replaces the list with the chosen section, and comes back', () => {
    renderMore();
    fireEvent.click(screen.getByRole('button', { name: /Categorization rules/ }));

    expect(screen.getByRole('heading', { name: 'Categorization rules' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Recurring expenses/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    expect(screen.getByRole('button', { name: /Recurring expenses/ })).toBeInTheDocument();
  });
});
