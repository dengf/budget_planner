import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import RulesSection from './RulesSection';

const CATEGORY = { id: 'food', name: 'Food' };

function renderRules({ save = vi.fn() } = {}) {
  const rules = { items: [], save, remove: vi.fn() };
  render(
    <I18nProvider initialLocale="en">
      <RulesSection
        wasmModule={{}}
        newId={() => 'rule-1'}
        confirm={vi.fn()}
        categories={{ items: [CATEGORY] }}
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

describe('RulesSection keyword field', () => {
  afterEach(() => {
    delete window.matchMedia;
  });

  it('adds the rule on Shift+Enter on desktop, without a click', async () => {
    mockDesktop();
    const { rules } = renderRules();
    fireEvent.change(screen.getByLabelText('Keyword'), { target: { value: 'Coffee' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'food' } });
    fireEvent.keyDown(screen.getByLabelText('Keyword'), { key: 'Enter', shiftKey: true });
    await waitFor(() =>
      expect(rules.save).toHaveBeenCalledWith(
        expect.objectContaining({ keyword: 'Coffee', category_id: 'food' }),
      ),
    );
  });

  it('clears the draft after Shift+Enter, ready for the next rule', async () => {
    mockDesktop();
    renderRules();
    fireEvent.change(screen.getByLabelText('Keyword'), { target: { value: 'Coffee' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'food' } });
    fireEvent.keyDown(screen.getByLabelText('Keyword'), { key: 'Enter', shiftKey: true });
    await waitFor(() => expect(screen.getByLabelText('Keyword')).toHaveValue(''));
    // Focus stays put so a second keyword can be typed immediately, letting
    // several rules go in back-to-back without reaching for the mouse.
    expect(screen.getByLabelText('Keyword')).toHaveFocus();
  });

  it('does nothing on Shift+Enter when no category has been chosen yet', () => {
    mockDesktop();
    const { rules } = renderRules();
    fireEvent.change(screen.getByLabelText('Keyword'), { target: { value: 'Coffee' } });
    fireEvent.keyDown(screen.getByLabelText('Keyword'), { key: 'Enter', shiftKey: true });
    expect(rules.save).not.toHaveBeenCalled();
  });

  it('ignores Shift+Enter on the phone shell, since this is a desktop-only shortcut', () => {
    // window.matchMedia is left unmocked, matching every other test in this
    // codebase's default "phone shell" behaviour (see useIsDesktop.js).
    const { rules } = renderRules();
    fireEvent.change(screen.getByLabelText('Keyword'), { target: { value: 'Coffee' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'food' } });
    fireEvent.keyDown(screen.getByLabelText('Keyword'), { key: 'Enter', shiftKey: true });
    expect(rules.save).not.toHaveBeenCalled();
  });
});
