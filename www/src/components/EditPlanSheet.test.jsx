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
});
