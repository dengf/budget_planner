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

    it('says the main field is the rest of the group once any subcategory has its own plan', () => {
      renderSheet({ subcategories: SUBS, plannedTotal: 120, onSaveSub: () => {} });
      expect(screen.getByText('$120.00')).toBeInTheDocument();
      expect(screen.getByLabelText('Planned for the rest of Food')).toHaveValue('100');
    });

    it('saves only the subcategory amounts that changed', () => {
      const onSave = vi.fn();
      const onSaveSub = vi.fn();
      renderSheet({ subcategories: SUBS, plannedTotal: 120, onSave, onSaveSub });
      fireEvent.change(screen.getByLabelText('Planned — Groceries'), { target: { value: '50' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(onSave).toHaveBeenCalledWith(100);
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
