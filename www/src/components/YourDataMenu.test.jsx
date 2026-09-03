import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import YourDataMenu from './YourDataMenu';
import { I18nProvider } from '../i18n';

function baseProps(overrides = {}) {
  return {
    wasmModule: {},
    today: '2026-09-03',
    viewMonth: '2026-09-03',
    categories: { items: [] },
    transactions: { items: [] },
    rules: { items: [] },
    budgetPlan: { items: [] },
    goals: { items: [] },
    debts: { items: [] },
    recurring: { items: [] },
    clearAllData: vi.fn(),
    importData: vi.fn(async () => ({ imported: 3 })),
    ...overrides,
  };
}

const show = (overrides = {}) =>
  render(
    <I18nProvider initialLocale="en">
      <YourDataMenu {...baseProps(overrides)} />
    </I18nProvider>,
  );

async function openMenu() {
  await userEvent.click(await screen.findByRole('button', { name: 'My data' }));
}

afterEach(() => {
  vi.restoreAllMocks();
  // Each test opts in to the picker API on `window` itself (it doesn't
  // exist in jsdom by default); clean up so it doesn't leak between tests.
  delete window.showSaveFilePicker;
  delete window.showOpenFilePicker;
  // A successful export writes a real "last exported" date to localStorage
  // (some environments back jsdom's localStorage with real persistence
  // across tests in the same file); clear it so one test's export doesn't
  // leak into the next test's "never exported yet" expectation. Some local
  // Node versions throw accessing the bare global here (the same reason
  // lastExported.js itself wraps every call in try/catch), so this must too.
  try {
    localStorage.clear();
  } catch {
    // Not available in this environment; nothing to clear.
  }
});

describe('export, without a File System Access picker', () => {
  beforeEach(() => {
    global.URL.createObjectURL = vi.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('says no backup has been made yet, until the first export', async () => {
    show();
    await openMenu();
    expect(screen.getByText("You haven't exported a backup yet.")).toBeInTheDocument();
  });

  it('downloads a JSON file and records that an export happened', async () => {
    show();
    await openMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Export all data' }));

    expect(global.URL.createObjectURL).toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();

    await openMenu();
    expect(screen.queryByText("You haven't exported a backup yet.")).toBeNull();
    expect(screen.getByText(/Last exported/)).toBeInTheDocument();
  });
});

describe('export, with a File System Access picker available', () => {
  it('saves through the native picker instead of downloading', async () => {
    const write = vi.fn();
    const close = vi.fn();
    const createWritable = vi.fn(async () => ({ write, close }));
    window.showSaveFilePicker = vi.fn(async () => ({ createWritable }));
    window.showOpenFilePicker = vi.fn();

    show();
    await openMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Export all data' }));

    expect(window.showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedName: 'budget-planner-2026-09-03.json',
      }),
    );
    expect(write).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();

    await openMenu();
    expect(screen.getByText(/Last exported/)).toBeInTheDocument();
  });

  it('leaves the dialog open with no error if the picker is cancelled', async () => {
    window.showSaveFilePicker = vi.fn(async () => {
      const err = new Error('cancelled');
      err.name = 'AbortError';
      throw err;
    });
    window.showOpenFilePicker = vi.fn();

    show();
    await openMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Export all data' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText("You haven't exported a backup yet.")).toBeInTheDocument();
  });

  it('shows an error if the write itself fails', async () => {
    window.showSaveFilePicker = vi.fn(async () => ({
      createWritable: vi.fn(async () => {
        throw new Error('disk full');
      }),
    }));
    window.showOpenFilePicker = vi.fn();

    show();
    await openMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Export all data' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save the file. Try again.");
  });

  it('shows the sync tip only when the picker is available', async () => {
    window.showSaveFilePicker = vi.fn();
    window.showOpenFilePicker = vi.fn();

    show();
    await openMenu();
    expect(screen.getByText(/choose a folder your other devices already sync/)).toBeInTheDocument();
  });
});

describe('import, without a File System Access picker', () => {
  it('imports through the hidden file input', async () => {
    const importData = vi.fn(async () => ({ imported: 7 }));
    show({ importData });
    await openMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Import data' }));

    const file = new File([JSON.stringify({ format: 'meifio.budget_planner.v1' })], 'backup.json', {
      type: 'application/json',
    });
    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: [file] },
    });

    await waitFor(() =>
      expect(importData).toHaveBeenCalledWith({
        format: 'meifio.budget_planner.v1',
      }),
    );
  });
});

describe('import, with a File System Access picker available', () => {
  it('imports through the native picker', async () => {
    const file = new File([JSON.stringify({ format: 'meifio.budget_planner.v1' })], 'backup.json', {
      type: 'application/json',
    });
    window.showOpenFilePicker = vi.fn(async () => [{ getFile: async () => file }]);
    window.showSaveFilePicker = vi.fn();

    const importData = vi.fn(async () => ({ imported: 4 }));
    show({ importData });
    await openMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Import data' }));

    // A successful import closes the dialog immediately (same as the
    // pre-existing fallback path) rather than showing a message in it.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(importData).toHaveBeenCalledWith({
      format: 'meifio.budget_planner.v1',
    });
  });

  it('leaves the dialog open with no error if the picker is cancelled', async () => {
    window.showOpenFilePicker = vi.fn(async () => {
      const err = new Error('cancelled');
      err.name = 'AbortError';
      throw err;
    });
    window.showSaveFilePicker = vi.fn();

    show();
    await openMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Import data' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows an error if the file cannot be read', async () => {
    window.showOpenFilePicker = vi.fn(async () => {
      throw new Error('permission revoked');
    });
    window.showSaveFilePicker = vi.fn();

    show();
    await openMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Import data' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't read that file. Try again.",
    );
  });
});
