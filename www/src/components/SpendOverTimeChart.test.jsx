import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../i18n';
import SpendOverTimeChart from './SpendOverTimeChart';

const MONTH = '2026-01';

function renderChart(props) {
  return render(
    <I18nProvider initialLocale="en">
      <SpendOverTimeChart
        dailyTotals={[
          { date: '2026-01-01', amount: 2000 },
          { date: '2026-01-05', amount: 5 },
        ]}
        weeklyTotals={[{ date: '2026-01-01', amount: 2005 }]}
        excludesRecurring={false}
        month={MONTH}
        daysInMonth={31}
        formatMoney={(n) => `$${n.toFixed(2)}`}
        locale="en"
        {...props}
      />
    </I18nProvider>,
  );
}

describe('SpendOverTimeChart granularity toggle', () => {
  it('defaults to the daily view with the plain total note', () => {
    renderChart();
    expect(screen.getByText('Spending by day')).toBeInTheDocument();
    expect(screen.getByText('$2005.00 spent this month, day by day')).toBeInTheDocument();
  });

  it('switches to the weekly view on tap', () => {
    renderChart();
    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));
    expect(screen.getByText('Spending by week')).toBeInTheDocument();
    expect(screen.getByText('$2005.00 spent this month, week by week')).toBeInTheDocument();
  });

  it('switches to a cumulative running-total view on tap', () => {
    renderChart();
    fireEvent.click(screen.getByRole('button', { name: 'Cumulative' }));
    expect(screen.getByText('Cumulative spending')).toBeInTheDocument();
    // Same grand total as the daily/weekly views -- a running total's
    // last value is always the month's full sum.
    expect(screen.getByText('$2005.00 spent this month so far')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /cumulative spending/i })).toBeInTheDocument();
  });
});

describe('SpendOverTimeChart recurring-exclusion note', () => {
  it('uses the plain total copy when nothing was excluded', () => {
    renderChart({ excludesRecurring: false });
    expect(screen.getByText('$2005.00 spent this month, day by day')).toBeInTheDocument();
  });

  it("qualifies every view's total once a recurring bill was excluded upstream", () => {
    renderChart({ excludesRecurring: true });
    expect(
      screen.getByText('$2005.00 spent this month, day by day, not counting recurring bills'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));
    expect(
      screen.getByText('$2005.00 spent this month, week by week, not counting recurring bills'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cumulative' }));
    expect(
      screen.getByText('$2005.00 spent this month so far, not counting recurring bills'),
    ).toBeInTheDocument();
  });
});

describe('SpendOverTimeChart include-recurring toggle', () => {
  const excludingDaily = [{ date: '2026-01-05', amount: 5 }];
  const includingDaily = [
    { date: '2026-01-01', amount: 2000 },
    { date: '2026-01-05', amount: 5 },
  ];
  const excludingWeekly = [{ date: '2026-01-01', amount: 5 }];
  const includingWeekly = [{ date: '2026-01-01', amount: 2005 }];

  function renderWithToggle(props) {
    return renderChart({
      dailyTotals: excludingDaily,
      weeklyTotals: excludingWeekly,
      dailyTotalsIncludingRecurring: includingDaily,
      weeklyTotalsIncludingRecurring: includingWeekly,
      excludesRecurring: true,
      ...props,
    });
  }

  it('hides the toggle when nothing was excluded this month', () => {
    renderChart({ excludesRecurring: false });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows the toggle, off by default, with the excluding total', () => {
    renderWithToggle();
    const checkbox = screen.getByRole('checkbox', { name: 'Include recurring bills' });
    expect(checkbox).not.toBeChecked();
    expect(
      screen.getByText('$5.00 spent this month, day by day, not counting recurring bills'),
    ).toBeInTheDocument();
  });

  it('switches to the full, unqualified total once switched on', () => {
    renderWithToggle();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include recurring bills' }));
    expect(screen.getByText('$2005.00 spent this month, day by day')).toBeInTheDocument();
  });

  it('still shows the chart for a month whose only spending was a settled bill', () => {
    // Excluding series is empty (the only transaction was matched to a
    // recurring bill), but the including series has it -- the chart, and
    // the toggle to reveal it, must not disappear just because the
    // default view sums to zero.
    renderChart({
      dailyTotals: [],
      weeklyTotals: [],
      dailyTotalsIncludingRecurring: [{ date: '2026-01-01', amount: 2000 }],
      weeklyTotalsIncludingRecurring: [{ date: '2026-01-01', amount: 2000 }],
      excludesRecurring: true,
    });
    expect(screen.getByRole('checkbox', { name: 'Include recurring bills' })).toBeInTheDocument();
    expect(
      screen.getByText('$0.00 spent this month, day by day, not counting recurring bills'),
    ).toBeInTheDocument();
  });
});

describe('SpendOverTimeChart empty state', () => {
  it('renders nothing when there is no spending at all this month', () => {
    const { container } = renderChart({ dailyTotals: [], weeklyTotals: [] });
    expect(container).toBeEmptyDOMElement();
  });
});
