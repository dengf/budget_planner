import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Header from './Header';
import { I18nProvider } from '../i18n';

function mockMatchMedia(matchesFor) {
  window.matchMedia = vi.fn((query) => ({
    matches: !!matchesFor[query],
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  delete window.matchMedia;
});

const show = () =>
  render(
    <I18nProvider initialLocale="en">
      <Header
        activeTab="dashboard"
        onTabChange={() => {}}
        today="2026-09"
        viewMonth="2026-09"
        setViewMonth={() => {}}
        categories={[]}
        transactions={[]}
        rules={[]}
        budgetPlan={{ items: [] }}
        goals={[]}
        debts={[]}
        recurring={[]}
        clearAllData={() => {}}
        importData={() => {}}
        currencySymbol="$"
        onCurrencySymbolChange={() => {}}
        theme="system"
        onThemeChange={() => {}}
      />
    </I18nProvider>,
  );

/**
 * The header is one row: the month stepper on the left, the language
 * picker and the settings gear on the right. At 375px the full language
 * names pushed that row over the 327px of content width available and it
 * wrapped, putting the language picker on a line of its own and costing
 * 48px of every phone screen. These two cases are what keeps the compact
 * labels on the phone and the readable ones everywhere else.
 */
describe('Header language picker', () => {
  it('shows the compact locale labels at phone width', () => {
    mockMatchMedia({ '(max-width: 640px)': true });
    show();

    const select = screen.getByLabelText('Language');
    expect([...select.options].map((o) => o.textContent)).toEqual(['EN', '简', '繁']);
  });

  it('spells the languages out once there is room for them', () => {
    mockMatchMedia({ '(max-width: 640px)': false });
    show();

    const select = screen.getByLabelText('Language');
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'English',
      '简体中文',
      '繁體中文',
    ]);
  });
});
