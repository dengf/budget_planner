import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import TransactionsTab from './TransactionsTab';

function renderTab(props) {
  return render(
    <I18nProvider initialLocale="en">
      <TransactionsTab
        wasmModule={{}}
        currencySymbol="$"
        today="2026-01-01"
        viewMonth="2026-01-01"
        setViewMonth={() => {}}
        newId={() => 'new-id'}
        confirm={() => Promise.resolve(true)}
        categories={{ items: [] }}
        transactions={{ items: [], save: vi.fn(), remove: vi.fn() }}
        rules={{ items: [], save: vi.fn(), remove: vi.fn() }}
        recurring={{ items: [], save: vi.fn(), remove: vi.fn() }}
        {...props}
      />
    </I18nProvider>,
  );
}

describe('TransactionsTab', () => {
  it('offers Log a transaction and Import CSV as the empty-state actions', () => {
    renderTab();
    expect(screen.getByRole('button', { name: 'Log a transaction' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import CSV' })).toBeInTheDocument();
  });

  it('opens the add sheet on Manual when "Log a transaction" is tapped', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Log a transaction' }));
    expect(screen.getByRole('tab', { name: 'Manual', selected: true })).toBeInTheDocument();
  });

  it('opens the add sheet on Import CSV when "Import CSV" is tapped', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }));
    expect(screen.getByRole('tab', { name: 'Import CSV', selected: true })).toBeInTheDocument();
  });

  it('keeps categorization rules and recurring setup collapsed behind a disclosure', () => {
    renderTab();
    const rulesDetails = screen.getByText('Categorization rules').closest('details');
    const recurringDetails = screen.getByText('Recurring expenses').closest('details');
    expect(rulesDetails).not.toHaveAttribute('open');
    expect(recurringDetails).not.toHaveAttribute('open');
  });

  it('renders the transaction history ahead of rules and recurring in document order', () => {
    renderTab();
    const headings = Array.from(document.querySelectorAll('h2, summary')).map(
      (el) => el.textContent,
    );
    expect(headings.indexOf('History')).toBeLessThan(headings.indexOf('Categorization rules'));
    expect(headings.indexOf('History')).toBeLessThan(headings.indexOf('Recurring expenses'));
  });
});
