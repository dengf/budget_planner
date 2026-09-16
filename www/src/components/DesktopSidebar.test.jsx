import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import DesktopSidebar from './DesktopSidebar';

function renderSidebar(props) {
  return render(
    <I18nProvider initialLocale="en">
      <DesktopSidebar
        activeTab="dashboard"
        moreSectionId={null}
        onNavigate={vi.fn()}
        onOpenAdd={vi.fn()}
        {...props}
      />
    </I18nProvider>,
  );
}

describe('DesktopSidebar', () => {
  it('renders the three top-level tabs plus all five More sections, flattened', () => {
    renderSidebar();
    for (const name of [
      'Dashboard',
      'Transactions',
      'Budget',
      'Categories',
      'Savings goals',
      'Debt payoff',
      'Categorization rules',
      'Recurring expenses',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeInTheDocument();
    }
    // "More" itself is not a sidebar destination -- its sections are
    // reachable directly, so there is no leftover "More" button.
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });

  it('navigates a top-level tab with no section id', () => {
    const onNavigate = vi.fn();
    renderSidebar({ onNavigate });
    fireEvent.click(screen.getByRole('button', { name: 'Budget' }));
    expect(onNavigate).toHaveBeenCalledWith('budget');
  });

  it('navigates a flattened section straight into "more"', () => {
    const onNavigate = vi.fn();
    renderSidebar({ onNavigate });
    fireEvent.click(screen.getByRole('button', { name: /Savings goals/ }));
    expect(onNavigate).toHaveBeenCalledWith('more', 'goals');
  });

  it('marks the active tab item, not any section item', () => {
    renderSidebar({ activeTab: 'budget', moreSectionId: null });
    expect(screen.getByRole('button', { name: 'Budget' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /Savings goals/ })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('marks the active section item when on "more" with a section chosen', () => {
    renderSidebar({ activeTab: 'more', moreSectionId: 'debt' });
    expect(screen.getByRole('button', { name: /Debt payoff/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });

  it('opens the add-transaction sheet from the sidebar', () => {
    const onOpenAdd = vi.fn();
    renderSidebar({ onOpenAdd });
    fireEvent.click(screen.getByRole('button', { name: /Add a transaction/ }));
    expect(onOpenAdd).toHaveBeenCalledWith('manual');
  });
});
