import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import MonthYearPicker from './MonthYearPicker';
import { I18nProvider } from '../i18n';

function Harness({ value = '2026-08', onChange = () => {}, todayMonth = '2026-08' }) {
  return (
    <I18nProvider initialLocale="en">
      <MonthYearPicker value={value} onChange={onChange} todayMonth={todayMonth} locale="en" />
    </I18nProvider>
  );
}

describe('MonthYearPicker', () => {
  it('shows the current value as the trigger label', () => {
    render(<Harness value="2026-08" />);
    expect(screen.getByText('August 2026')).toBeInTheDocument();
  });

  it('steps to the adjacent month without opening the popup', async () => {
    const onChange = vi.fn();
    render(<Harness value="2026-08" onChange={onChange} />);
    await userEvent.click(screen.getByLabelText('Next month'));
    expect(onChange).toHaveBeenCalledWith('2026-09');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a year+month grid when the label is tapped', async () => {
    render(<Harness value="2026-08" />);
    await userEvent.click(screen.getByText('August 2026'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('2026')).toBeInTheDocument();
  });

  it('the year stepper changes the grid without closing the popup', async () => {
    render(<Harness value="2026-08" />);
    await userEvent.click(screen.getByText('August 2026'));
    await userEvent.click(screen.getByLabelText('Next year'));
    expect(screen.getByText('2027')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('picking a month in the grid calls onChange and closes the popup', async () => {
    const onChange = vi.fn();
    render(<Harness value="2026-08" onChange={onChange} />);
    await userEvent.click(screen.getByText('August 2026'));
    await userEvent.click(screen.getByRole('button', { name: 'Mar' }));
    expect(onChange).toHaveBeenCalledWith('2026-03');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('jumping to the current month calls onChange with todayMonth and closes', async () => {
    const onChange = vi.fn();
    render(<Harness value="2026-03" todayMonth="2026-08" onChange={onChange} />);
    await userEvent.click(screen.getByText('March 2026'));
    await userEvent.click(screen.getByText('This month'));
    expect(onChange).toHaveBeenCalledWith('2026-08');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('tapping the backdrop closes the popup without calling onChange', async () => {
    const onChange = vi.fn();
    render(<Harness value="2026-08" onChange={onChange} />);
    await userEvent.click(screen.getByText('August 2026'));
    // eslint-disable-next-line testing-library/no-node-access
    await userEvent.click(document.querySelector('.monthpicker-backdrop'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
