import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import NewCategoryField from './NewCategoryField';

/**
 * What each outcome *means* is `budget_calc::resolve_category_name`, and
 * it is tested there -- these cover the half that only exists in the
 * browser: which outcomes select a category, which one only says
 * something, and that a name is never saved twice.
 *
 * `create` is a plain stub returning a scripted outcome rather than a
 * reimplementation of the matching rule. A mock that re-derives the rule
 * can only ever agree with itself; this asserts the wiring.
 */
function renderField({ outcome, categoryId, isIncome = false } = {}) {
  const create = vi.fn(async () => ({ outcome, categoryId }));
  const onCreated = vi.fn();
  render(
    <I18nProvider initialLocale="en">
      <NewCategoryField isIncome={isIncome} create={create} onCreated={onCreated} />
    </I18nProvider>,
  );
  return { create, onCreated };
}

const type = (value) =>
  fireEvent.change(screen.getByLabelText('Category name'), { target: { value } });

describe('NewCategoryField', () => {
  it('cannot be submitted until a name is typed', () => {
    renderField({ outcome: 'create', categoryId: 'c9' });
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    type('  ');
    // Whitespace is not a name -- the button would otherwise invite a tap
    // that creates nothing.
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it('quotes the name back on the button before anything is saved', () => {
    renderField({ outcome: 'create', categoryId: 'c9' });
    type('Vet bills');
    expect(screen.getByRole('button', { name: 'Create “Vet bills”' })).toBeEnabled();
  });

  it('reports the new category up so the caller can select it', async () => {
    const { create, onCreated } = renderField({ outcome: 'create', categoryId: 'c9' });
    type('Vet bills');
    fireEvent.click(screen.getByRole('button', { name: 'Create “Vet bills”' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('c9'));
    expect(create).toHaveBeenCalledWith('Vet bills', false);
  });

  it('passes the income side through, so the section it sits under decides', async () => {
    const { create } = renderField({ outcome: 'create', categoryId: 'c9', isIncome: true });
    type('Dividends');
    fireEvent.click(screen.getByRole('button', { name: 'Create “Dividends”' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('Dividends', true));
  });

  it('selects an existing category instead of announcing a new one', async () => {
    // `existing` is the outcome for a name already on this side of the
    // ledger. It reaches `onCreated` exactly like a fresh one: from the
    // caller's side "this is now the chosen category" is the same fact
    // either way, and nothing was duplicated to get there.
    const { onCreated } = renderField({ outcome: 'existing', categoryId: 'food' });
    type('Food');
    fireEvent.click(screen.getByRole('button', { name: 'Create “Food”' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('food'));
  });

  it('explains a name held on the other side rather than duplicating it', async () => {
    const { onCreated } = renderField({ outcome: 'other_direction', categoryId: 'salary' });
    type('Salary');
    fireEvent.click(screen.getByRole('button', { name: 'Create “Salary”' }));
    await screen.findByText('“Salary” is already an income category — try a different name.');
    // Nothing is selected: the category that clashed is on the side this
    // form cannot file against, so "created" would be a lie and
    // "selected" would be impossible.
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('clears the clash message once the name changes', async () => {
    renderField({ outcome: 'other_direction', categoryId: 'salary' });
    type('Salary');
    fireEvent.click(screen.getByRole('button', { name: 'Create “Salary”' }));
    await screen.findByText('“Salary” is already an income category — try a different name.');
    type('Salary reimbursement');
    // A standing complaint about the previous name reads as a complaint
    // about the one now in the field.
    expect(
      screen.queryByText('“Salary” is already an income category — try a different name.'),
    ).not.toBeInTheDocument();
  });

  it('submits on Enter, since the field has no form of its own to submit', async () => {
    const { onCreated } = renderField({ outcome: 'create', categoryId: 'c9' });
    type('Vet bills');
    fireEvent.keyDown(screen.getByLabelText('Category name'), { key: 'Enter' });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('c9'));
  });
});
