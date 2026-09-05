import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import CategoryChipPicker from './CategoryChipPicker';

const HOUSING = {
  key: 'cat.housing',
  group_key: 'cat.group.expense',
  is_income: false,
  description_key: 'cat.housing.desc',
};

function renderPicker(props) {
  return render(
    <I18nProvider initialLocale="en">
      <CategoryChipPicker presets={[HOUSING]} onAdd={() => {}} {...props} />
    </I18nProvider>,
  );
}

describe('CategoryChipPicker', () => {
  it('renders a chip per preset it is given', () => {
    renderPicker();
    expect(screen.getByRole('button', { name: /Housing/i })).toBeInTheDocument();
  });

  it('calls onAdd with exactly the tapped preset', () => {
    const onAdd = vi.fn();
    renderPicker({ onAdd });
    fireEvent.click(screen.getByRole('button', { name: /Housing/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith(HOUSING);
  });

  it('renders nothing when it is given no presets', () => {
    const { container } = render(
      <I18nProvider initialLocale="en">
        <CategoryChipPicker presets={[]} onAdd={() => {}} />
      </I18nProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
