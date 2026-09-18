import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import RulesSection from './RulesSection';

const CATEGORY = { id: 'food', name: 'Food' };
const OTHER = { id: 'transport', name: 'Transport' };

function renderRules({ save = vi.fn() } = {}) {
  let seq = 0;
  const rules = { items: [], save, remove: vi.fn() };
  render(
    <I18nProvider initialLocale="en">
      <RulesSection
        wasmModule={{}}
        newId={() => `rule-${(seq += 1)}`}
        confirm={vi.fn()}
        categories={{ items: [CATEGORY, OTHER] }}
        transactions={{ items: [], save: vi.fn() }}
        rules={rules}
      />
    </I18nProvider>,
  );
  return { rules };
}

function mockDesktop() {
  window.matchMedia = vi.fn(() => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const keyword = (n) => screen.getByLabelText(`Keyword, row ${n}`);
const category = (n) => screen.getByLabelText(`Category, row ${n}`);
const priority = (n) => screen.getByLabelText(`Priority, row ${n}`);

function fillRow(n, { keyword: kw, category: cat }) {
  fireEvent.change(keyword(n), { target: { value: kw } });
  fireEvent.change(category(n), { target: { value: cat } });
}

describe('RulesSection desktop rows', () => {
  afterEach(() => {
    delete window.matchMedia;
  });

  it('saves every finished row in one submit', async () => {
    mockDesktop();
    const { rules } = renderRules();
    fillRow(1, { keyword: 'Coffee', category: 'food' });
    fillRow(2, { keyword: 'Taxi', category: 'transport' });
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 rules' }));
    await waitFor(() => expect(rules.save).toHaveBeenCalledTimes(2));
    expect(rules.save).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: 'Coffee', category_id: 'food' }),
    );
    expect(rules.save).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: 'Taxi', category_id: 'transport' }),
    );
  });

  it('gives each saved rule its own id, so a batch is not one rule overwritten', async () => {
    mockDesktop();
    const { rules } = renderRules();
    fillRow(1, { keyword: 'Coffee', category: 'food' });
    fillRow(2, { keyword: 'Taxi', category: 'transport' });
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 rules' }));
    await waitFor(() => expect(rules.save).toHaveBeenCalledTimes(2));
    const ids = rules.save.mock.calls.map(([rule]) => rule.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('adds a row on Shift+Enter and puts the caret in its keyword field', async () => {
    mockDesktop();
    renderRules();
    fireEvent.keyDown(keyword(1), { key: 'Enter', shiftKey: true });
    await waitFor(() => expect(keyword(2)).toBeInTheDocument());
    expect(keyword(2)).toHaveFocus();
  });

  it('moves to the row below on Shift+Enter instead of stranding a blank row above the caret', async () => {
    mockDesktop();
    renderRules();
    // Typing a keyword already grows a row underneath, so the shortcut
    // from row 1 should land in that row rather than append a third.
    fireEvent.change(keyword(1), { target: { value: 'Coffee' } });
    fireEvent.keyDown(keyword(1), { key: 'Enter', shiftKey: true });
    await waitFor(() => expect(keyword(2)).toHaveFocus());
    expect(screen.queryByLabelText('Keyword, row 3')).not.toBeInTheDocument();
  });

  it('grows a fresh row once a keyword is typed in the last one', () => {
    mockDesktop();
    renderRules();
    expect(screen.queryByLabelText('Keyword, row 2')).not.toBeInTheDocument();
    fireEvent.change(keyword(1), { target: { value: 'Coffee' } });
    expect(keyword(2)).toBeInTheDocument();
  });

  it('adds a row from the button, for anyone who never finds the shortcut', () => {
    mockDesktop();
    renderRules();
    fireEvent.click(screen.getByRole('button', { name: '+ Add a row' }));
    expect(keyword(2)).toBeInTheDocument();
  });

  it('removes a row, and never the last one', () => {
    mockDesktop();
    renderRules();
    // Nothing to remove while one row is all there is -- removing it
    // would leave nowhere to type.
    expect(screen.getByRole('button', { name: 'Remove row 1' })).toBeDisabled();
    fireEvent.change(keyword(1), { target: { value: 'Coffee' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove row 1' }));
    expect(keyword(1)).toHaveValue('');
    expect(screen.queryByLabelText('Keyword, row 2')).not.toBeInTheDocument();
  });

  it('will not submit until a row is finished, so the button never promises nothing', () => {
    mockDesktop();
    const { rules } = renderRules();
    const submit = screen.getByRole('button', { name: 'Add rule' });
    expect(submit).toBeDisabled();
    // A keyword with no category is still unfinished: which category it
    // files under is the whole content of a rule.
    fireEvent.change(keyword(1), { target: { value: 'Coffee' } });
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled();
    fireEvent.change(category(1), { target: { value: 'food' } });
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeEnabled();
    expect(rules.save).not.toHaveBeenCalled();
  });

  it('counts only the finished rows in the button, not every row on screen', () => {
    mockDesktop();
    renderRules();
    fillRow(1, { keyword: 'Coffee', category: 'food' });
    fillRow(2, { keyword: 'Taxi', category: 'transport' });
    // Row 3 exists and has a keyword, but no category yet.
    fireEvent.change(keyword(3), { target: { value: 'Rent' } });
    expect(screen.getByRole('button', { name: 'Add 2 rules' })).toBeInTheDocument();
  });

  it('keeps a half-finished row after saving the finished ones, rather than dropping it silently', async () => {
    mockDesktop();
    const { rules } = renderRules();
    fillRow(1, { keyword: 'Coffee', category: 'food' });
    fireEvent.change(keyword(2), { target: { value: 'Rent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() => expect(rules.save).toHaveBeenCalledTimes(1));
    // The saved row is gone; the one still missing a category stays put,
    // which is the only honest report of what did and didn't go in.
    await waitFor(() => expect(keyword(1)).toHaveValue('Rent'));
    expect(keyword(2)).toHaveValue('');
  });

  it('clears the rows after a clean batch, ready for the next one', async () => {
    mockDesktop();
    const { rules } = renderRules();
    fillRow(1, { keyword: 'Coffee', category: 'food' });
    fillRow(2, { keyword: 'Taxi', category: 'transport' });
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 rules' }));
    await waitFor(() => expect(rules.save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(keyword(1)).toHaveValue(''));
    expect(screen.queryByLabelText('Keyword, row 2')).not.toBeInTheDocument();
  });

  it('carries the typed priority through, defaulting to 0', async () => {
    mockDesktop();
    const { rules } = renderRules();
    fillRow(1, { keyword: 'Coffee', category: 'food' });
    fireEvent.change(priority(1), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() =>
      expect(rules.save).toHaveBeenCalledWith(expect.objectContaining({ priority: 10 })),
    );
  });

  it('ignores a letter typed into priority instead of blanking the field', () => {
    mockDesktop();
    renderRules();
    fireEvent.change(priority(1), { target: { value: '10' } });
    fireEvent.change(priority(1), { target: { value: '10a' } });
    expect(priority(1)).toHaveValue('10');
  });

  it('shows the shortcut hint on desktop', () => {
    mockDesktop();
    renderRules();
    expect(screen.getByText('Shift + Enter adds a row')).toBeInTheDocument();
  });
});

describe('RulesSection on the phone shell', () => {
  afterEach(() => {
    delete window.matchMedia;
  });

  // window.matchMedia is left unmocked, matching every other test in this
  // codebase's default "phone shell" behaviour (see useIsDesktop.js).
  it('keeps the single draft form, which is what fits 375px', () => {
    renderRules();
    expect(screen.getByLabelText('Keyword')).toBeInTheDocument();
    expect(screen.queryByLabelText('Keyword, row 1')).not.toBeInTheDocument();
  });

  it('saves the one draft rule', async () => {
    const { rules } = renderRules();
    fireEvent.change(screen.getByLabelText('Keyword'), { target: { value: 'Coffee' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'food' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await waitFor(() =>
      expect(rules.save).toHaveBeenCalledWith(
        expect.objectContaining({ keyword: 'Coffee', category_id: 'food' }),
      ),
    );
    await waitFor(() => expect(screen.getByLabelText('Keyword')).toHaveValue(''));
  });

  it('hides the row shortcut hint, since there are no rows here', () => {
    renderRules();
    expect(screen.queryByText('Shift + Enter adds a row')).not.toBeInTheDocument();
  });
});
