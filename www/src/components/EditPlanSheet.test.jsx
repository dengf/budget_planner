import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import EditPlanSheet from './EditPlanSheet';

const formatMoney = (n) => `$${Number(n).toFixed(2)}`;

function renderSheet(props) {
  return render(
    <I18nProvider initialLocale="en">
      <EditPlanSheet
        open
        onClose={() => {}}
        title="Food"
        badge={null}
        subtitle="Living"
        planned={100}
        spentLabel="Spent"
        spent={40}
        remaining={{ className: 'positive', text: '$60.00' }}
        formatMoney={formatMoney}
        onSave={() => {}}
        {...props}
      />
    </I18nProvider>,
  );
}

describe('EditPlanSheet', () => {
  it('saves the typed amount and closes', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    renderSheet({ onSave, onClose });

    fireEvent.change(screen.getByLabelText('Planned'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith(250);
    expect(onClose).toHaveBeenCalled();
  });

  it('folds an upcoming recurring amount into the field without saving it yet', () => {
    const onSave = vi.fn();
    renderSheet({ onSave, upcoming: { amount: 25 } });

    fireEvent.click(screen.getByRole('button', { name: /Add to planned/ }));
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(125);
  });

  it('re-seeds the draft from `planned` each time it opens', () => {
    const { rerender } = renderSheet({ planned: 100, open: false });
    rerender(
      <I18nProvider initialLocale="en">
        <EditPlanSheet
          open
          onClose={() => {}}
          title="Food"
          subtitle="Living"
          planned={100}
          spentLabel="Spent"
          spent={40}
          remaining={{ className: 'positive', text: '$60.00' }}
          formatMoney={formatMoney}
          onSave={() => {}}
        />
      </I18nProvider>,
    );
    expect(screen.getByLabelText('Planned')).toHaveValue('100');
  });

  describe('subcategories', () => {
    const SUBS = [
      { id: 'groceries', name: 'Groceries', spent: 30, planned: 0 },
      { id: 'care', name: 'Toiletries', spent: 10, planned: 20 },
    ];

    // Stands in for `budget_calc::group_planned`, which is tested in Rust.
    const groupPlanned = (own, subs) => ({
      total: subs.some((n) => n > 0) ? subs.reduce((a, n) => a + n, 0) : own,
    });

    it('shows the subcategories’ sum as the total, with no second group amount to type', async () => {
      renderSheet({ subcategories: SUBS, plannedTotal: 20, onSaveSub: () => {}, groupPlanned });
      expect(await screen.findByText('$20.00')).toBeInTheDocument();
      expect(screen.queryByLabelText('Planned')).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Planned — Groceries'), { target: { value: '50' } });
      expect(await screen.findByText('$70.00')).toBeInTheDocument();
    });

    it('never adds a typed group total to the split it is divided into', async () => {
      // The bug report: 5000 typed on the group, then split 3000/2000.
      const onSave = vi.fn();
      const onSaveSub = vi.fn();
      const subs = [
        { id: 'salary', name: 'Salary', spent: 0, planned: 0 },
        { id: 'bonus', name: 'Bonus', spent: 0, planned: 0 },
      ];
      renderSheet({ planned: 0, subcategories: subs, onSave, onSaveSub, groupPlanned });
      fireEvent.change(screen.getByLabelText('Planned'), { target: { value: '5000' } });
      fireEvent.change(screen.getByLabelText('Planned — Salary'), { target: { value: '3000' } });
      fireEvent.change(screen.getByLabelText('Planned — Bonus'), { target: { value: '2000' } });
      expect(await screen.findByText('$5000.00')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(onSave).not.toHaveBeenCalled();
      expect(onSaveSub).toHaveBeenCalledWith('salary', 3000);
      expect(onSaveSub).toHaveBeenCalledWith('bonus', 2000);
    });

    it('clears the group’s own amount when saving a split, so it cannot resurface', () => {
      const onSave = vi.fn();
      const onSaveSub = vi.fn();
      renderSheet({ subcategories: SUBS, plannedTotal: 20, onSave, onSaveSub, groupPlanned });
      fireEvent.change(screen.getByLabelText('Planned — Groceries'), { target: { value: '50' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(onSave).toHaveBeenCalledWith(0);
      expect(onSaveSub).toHaveBeenCalledTimes(1);
      expect(onSaveSub).toHaveBeenCalledWith('groceries', 50);
    });

    it('keeps the plain Planned label when no subcategory is planned on its own', () => {
      renderSheet({
        subcategories: [{ id: 'groceries', name: 'Groceries', spent: 0, planned: 0 }],
        plannedTotal: 100,
      });
      expect(screen.getByLabelText('Planned')).toBeInTheDocument();
    });
  });
});
