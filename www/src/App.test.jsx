import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, afterEach } from 'vitest';
import App from './App';
import { currentMonth } from './month';

/**
 * Exercises Export / Clear all data / Import through the real App wiring
 * (App.jsx's own `exportData`/`importData`/`clearAllData`, YourDataMenu,
 * ConfirmDialog and `backup.js`'s `readBackup`) end to end, against a fake
 * wasm module shaped exactly like `unavailable.js`'s real fallback (same
 * in-memory-collection pattern), rather than mocking `importData` the way
 * YourDataMenu.test.jsx does. That file proves the dialog's own mechanics;
 * this proves the round trip those mechanics are wired to actually
 * restores what it exported, which nothing else in the suite covers.
 */
function inMemoryCollection() {
  let records = [];
  return {
    async save(record) {
      const id = record.id || `local-${Math.random()}`;
      records = records.filter((r) => r.id !== id);
      records.push({ ...record, id });
      return { id, error: null };
    },
    async list() {
      return records;
    },
    async delete(id) {
      records = records.filter((r) => r.id !== id);
      return { success: true, error: null };
    },
  };
}

function makeFakeWasm() {
  const stores = {
    categories: inMemoryCollection(),
    transactions: inMemoryCollection(),
    goals: inMemoryCollection(),
    debts: inMemoryCollection(),
    recurring: inMemoryCollection(),
    budgetPlan: inMemoryCollection(),
    rules: inMemoryCollection(),
  };
  let idSeq = 0;
  return {
    _stores: stores,
    new_id: () => `test-id-${idSeq++}`,
    init_storage: async () => {},
    // No starter presets in this fake -- seedData below sets up exactly
    // the records each test wants, and an auto-seed racing that setup
    // would make counts non-deterministic.
    preset_categories: async () => [],
    compact_preset_categories: async () => [],
    uncategorized: async ({ transactions, existing_category_ids }) => {
      const ids = transactions
        .filter((t) => !t.category_id?.trim() || !existing_category_ids.includes(t.category_id))
        .map((t) => t.id);
      return { ids, count: ids.length, error: null };
    },
    save_category: (dto) => stores.categories.save(dto),
    list_categories: () => stores.categories.list(),
    delete_category: (id) => stores.categories.delete(id),
    save_transaction: (dto) => stores.transactions.save(dto),
    list_transactions: () => stores.transactions.list(),
    delete_transaction: (id) => stores.transactions.delete(id),
    save_goal: (dto) => stores.goals.save(dto),
    list_goals: () => stores.goals.list(),
    delete_goal: (id) => stores.goals.delete(id),
    save_debt: (dto) => stores.debts.save(dto),
    list_debts: () => stores.debts.list(),
    delete_debt: (id) => stores.debts.delete(id),
    save_recurring_expense: (dto) => stores.recurring.save(dto),
    list_recurring_expenses: () => stores.recurring.list(),
    delete_recurring_expense: (id) => stores.recurring.delete(id),
    save_budget_plan_entry: (dto) => stores.budgetPlan.save(dto),
    list_budget_plan: async (month) =>
      (await stores.budgetPlan.list()).filter((r) => r.month === month),
    delete_budget_plan_entry: (id) => stores.budgetPlan.delete(id),
    save_rule: (dto) => stores.rules.save(dto),
    list_rules: () => stores.rules.list(),
    delete_rule: (id) => stores.rules.delete(id),
  };
}

const TODAY = currentMonth();

async function seedData(wasm) {
  await wasm.save_category({ id: 'cat-food', name: 'Groceries', group: 'Food', is_income: false });
  await wasm.save_category({ id: 'cat-income', name: 'Salary', group: 'Income', is_income: true });
  await wasm.save_transaction({
    id: 'txn-1',
    date: `${TODAY}-05`,
    description: 'NTUC FairPrice',
    amount: -42.5,
    category_id: 'cat-food',
  });
  await wasm.save_goal({
    id: 'goal-1',
    name: 'Emergency fund',
    target_amount: 5000,
    saved_amount: 1200,
  });
  await wasm.save_debt({
    id: 'debt-1',
    name: 'Credit card',
    balance: 2000,
    apr: 21,
    min_payment: 50,
  });
  await wasm.save_recurring_expense({
    id: 'rec-1',
    description: 'Netflix',
    amount: 15,
    cadence: 'monthly',
    category_id: 'cat-food',
  });
  await wasm.save_budget_plan_entry({
    id: 'plan-1',
    month: TODAY,
    category_id: 'cat-food',
    planned: 400,
  });
}

async function storeCounts(wasm) {
  const [categories, transactions, goals, debts, recurring, budgetPlan] = await Promise.all([
    wasm.list_categories(),
    wasm.list_transactions(),
    wasm.list_goals(),
    wasm.list_debts(),
    wasm.list_recurring_expenses(),
    wasm.list_budget_plan(TODAY),
  ]);
  return { categories, transactions, goals, debts, recurring, budgetPlan };
}

async function openSettings() {
  await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
}

afterEach(() => {
  vi.restoreAllMocks();
  try {
    localStorage.clear();
  } catch {
    // Not available in every environment; nothing to clear.
  }
});

describe('export -> clear all data -> import round trip', () => {
  it('restores every collection to exactly what was exported', async () => {
    const wasm = makeFakeWasm();
    await seedData(wasm);

    let capturedBlob;
    global.URL.createObjectURL = vi.fn((blob) => {
      capturedBlob = blob;
      return 'blob:mock';
    });
    global.URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<App wasmModule={wasm} />);

    // Sanity check on the seed itself, before touching Export/Clear/Import.
    const before = await storeCounts(wasm);
    expect(before.categories).toHaveLength(2);
    expect(before.transactions).toHaveLength(1);
    expect(before.goals).toHaveLength(1);
    expect(before.debts).toHaveLength(1);
    expect(before.recurring).toHaveLength(1);
    expect(before.budgetPlan).toHaveLength(1);

    // --- Export ---
    await openSettings();
    await userEvent.click(await screen.findByRole('button', { name: 'Export all data' }));

    expect(capturedBlob).toBeInstanceOf(Blob);
    const exported = JSON.parse(await capturedBlob.text());
    expect(exported.format).toBe('meifio.budget_planner.v1');
    expect(exported.categories).toHaveLength(2);
    expect(exported.transactions).toHaveLength(1);
    expect(exported.goals).toHaveLength(1);
    expect(exported.debts).toHaveLength(1);
    expect(exported.recurring).toHaveLength(1);
    expect(exported.budget_plan.month).toBe(TODAY);
    expect(exported.budget_plan.entries).toHaveLength(1);

    // Settings closed after a successful export.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // --- Clear all data ---
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Clear all data' }));
    const clearConfirm = await screen.findByRole('alertdialog');
    await userEvent.click(within(clearConfirm).getByRole('button', { name: 'Clear all data' }));

    await waitFor(async () => {
      const cleared = await storeCounts(wasm);
      expect(cleared.categories).toHaveLength(0);
      expect(cleared.transactions).toHaveLength(0);
      expect(cleared.goals).toHaveLength(0);
      expect(cleared.debts).toHaveLength(0);
      expect(cleared.recurring).toHaveLength(0);
      expect(cleared.budgetPlan).toHaveLength(0);
    });
    // No starter presets configured on this fake wasm, so clearing really
    // does leave the app at zero rather than a reseeded starter set --
    // confirms `seedStarterCategories` is a no-op when the engine offers
    // nothing, rather than crashing on a missing preset list.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // --- Import the file just exported ---
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Import data' }));
    const file = new File([JSON.stringify(exported)], 'backup.json', {
      type: 'application/json',
    });
    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: [file] },
    });

    const importConfirm = await screen.findByRole('alertdialog');
    // 2 categories + 1 transaction + 1 goal + 1 debt + 1 recurring + 1
    // budget-plan entry -- backup.js's count adds the plan entries on top
    // of the six named collections, so this is 7, not 6.
    expect(importConfirm).toHaveTextContent('7');
    await userEvent.click(within(importConfirm).getByRole('button', { name: 'Replace' }));

    // A successful import closes Settings immediately (YourDataMenu's
    // `importFromFile` calls `setOpen(false)` before ever reaching
    // `setImportResult`) -- so `data.imported` ("N records restored.")
    // is dead copy that can never actually render. Same silent-success
    // convention as Export, just confirmed here rather than assumed.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const after = await storeCounts(wasm);
    expect(after.categories).toHaveLength(2);
    expect(after.transactions).toHaveLength(1);
    expect(after.transactions[0]).toMatchObject({ description: 'NTUC FairPrice', amount: -42.5 });
    expect(after.goals).toHaveLength(1);
    expect(after.goals[0]).toMatchObject({ name: 'Emergency fund', saved_amount: 1200 });
    expect(after.debts).toHaveLength(1);
    expect(after.debts[0]).toMatchObject({ name: 'Credit card', balance: 2000 });
    expect(after.recurring).toHaveLength(1);
    expect(after.recurring[0]).toMatchObject({ description: 'Netflix', amount: 15 });
    expect(after.budgetPlan).toHaveLength(1);
    expect(after.budgetPlan[0]).toMatchObject({ category_id: 'cat-food', planned: 400 });

    // And it shows up live in the UI, not just in the underlying store --
    // Transactions is the one top-level tab that needs no extra calc
    // bindings on this fake wasm to render.
    await userEvent.click(screen.getByRole('button', { name: 'Transactions' }));
    expect(await screen.findByText('NTUC FairPrice')).toBeInTheDocument();
  });

  it('rejects a file that is not this app export format, without touching existing data', async () => {
    const wasm = makeFakeWasm();
    await seedData(wasm);
    render(<App wasmModule={wasm} />);

    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Import data' }));
    const badFile = new File([JSON.stringify({ some: 'other app export' })], 'random.json', {
      type: 'application/json',
    });
    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: [badFile] },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "That file isn't a Budget Planner export — nothing was changed.",
    );
    // Dialog stays open on an error rather than silently closing.
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const untouched = await storeCounts(wasm);
    expect(untouched.transactions).toHaveLength(1);
    expect(untouched.categories).toHaveLength(2);
  });

  it('notifies rather than reporting success when a record fails to save mid-import', async () => {
    const wasm = makeFakeWasm();
    await seedData(wasm);
    // A shape-valid record `readBackup` has no reason to reject, but the
    // engine itself refuses -- e.g. a plan entry whose amount it can't
    // parse. This is the case the pre-flight validation in backup.js
    // can't catch, and the one `importData`'s save loop used to swallow.
    const realSaveCategory = wasm.save_category;
    wasm.save_category = async (dto) =>
      dto.id === 'cat-income' ? { error: 'engine rejected this record' } : realSaveCategory(dto);

    render(<App wasmModule={wasm} />);
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Export all data' }));
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Import data' }));

    const file = new File(
      [
        JSON.stringify({
          format: 'meifio.budget_planner.v1',
          categories: [
            { id: 'cat-food', name: 'Groceries', group: 'Food' },
            { id: 'cat-income', name: 'Salary', group: 'Income' },
          ],
          transactions: [],
          rules: [],
          goals: [],
          debts: [],
          recurring: [],
          budget_plan: { month: TODAY, entries: [] },
        }),
      ],
      'backup.json',
      { type: 'application/json' },
    );
    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: [file] },
    });

    const confirmDialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(confirmDialog).getByRole('button', { name: 'Replace' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "That backup couldn't be fully restored. Check your data before continuing.",
    );
    // Unlike a clean success, this leaves the dialog open -- a failure
    // that closed the dialog anyway would look identical to success.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('leaves existing data untouched if the replace confirmation is declined', async () => {
    const wasm = makeFakeWasm();
    await seedData(wasm);
    render(<App wasmModule={wasm} />);

    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Export all data' }));
    // Re-open after export closed the dialog.
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Import data' }));

    const differentFile = new File(
      [
        JSON.stringify({
          format: 'meifio.budget_planner.v1',
          categories: [{ id: 'cat-other', name: 'Other', group: 'Misc' }],
          transactions: [],
          rules: [],
          goals: [],
          debts: [],
          recurring: [],
          budget_plan: { month: TODAY, entries: [] },
        }),
      ],
      'other.json',
      { type: 'application/json' },
    );
    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: [differentFile] },
    });

    const confirmDialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(confirmDialog).getByRole('button', { name: 'Cancel' }));

    // Cancelling leaves the Settings dialog open, exactly as it was.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const untouched = await storeCounts(wasm);
    expect(untouched.categories).toHaveLength(2);
    expect(untouched.categories.some((c) => c.id === 'cat-other')).toBe(false);
  });
});
