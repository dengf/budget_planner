import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import AddTransactionSheet from './AddTransactionSheet';

const CATEGORIES = {
  items: [
    { id: 'inc1', name: 'Primary Earned Income', is_income: true },
    { id: 'exp1', name: 'Housing', is_income: false },
  ],
};

/**
 * Stands in for the three bindings this sheet calls on the amount and
 * the rule keyword, mirroring what `budget-calc` does -- the real rules
 * (rounding, the zero case, the trimming heuristic) are tested in Rust,
 * and duplicating them here would just be the second implementation
 * those bindings exist to prevent.
 */
const WASM = {
  split_amount: async (amount) => ({
    magnitude: Math.abs(amount),
    is_income: amount > 0,
    error: null,
  }),
  signed_amount: async ({ magnitude, is_income }) => ({
    amount: is_income ? Math.abs(magnitude) : -Math.abs(magnitude),
    error: null,
  }),
  suggest_rule_keyword: async ({ description }) => ({
    keyword: description.split(/\s+/)[0]?.toLowerCase() || null,
    error: null,
  }),
};

function renderSheet(props) {
  const transactions = { items: [], save: vi.fn() };
  const utils = render(
    <I18nProvider initialLocale="en">
      <AddTransactionSheet
        open
        onClose={() => {}}
        wasmModule={WASM}
        newId={() => 'new-id'}
        today="2026-01-01"
        categories={CATEGORIES}
        rules={{ items: [] }}
        transactions={transactions}
        recurring={{ items: [] }}
        formatMoney={(n) => `$${n}`}
        {...props}
      />
    </I18nProvider>,
  );
  return { ...utils, transactions };
}

describe('AddTransactionSheet manual entry', () => {
  // The chips are the category picker now; a dropdown listing every
  // category cost three interactions for the app's most common action.
  it('defaults to Expense mode with only expense categories offered', () => {
    renderSheet();
    expect(screen.getByRole('tab', { name: 'Expense' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Housing' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Primary Earned Income' })).not.toBeInTheDocument();
  });

  it('switches to Income mode and offers only income categories', () => {
    renderSheet();
    fireEvent.click(screen.getByRole('tab', { name: 'Income' }));
    expect(screen.getByRole('button', { name: 'Primary Earned Income' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Housing' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add income' })).toBeInTheDocument();
  });

  it('saves an expense as a negative amount from a plain positive input', async () => {
    const { transactions } = renderSheet();
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-01-05' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Rent' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Housing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add $500 to Housing' }));
    await waitFor(() =>
      expect(transactions.save).toHaveBeenCalledWith(
        expect.objectContaining({ amount: -500, category_id: 'exp1' }),
      ),
    );
  });

  it('saves income as a positive amount from the same plain positive input', async () => {
    const { transactions } = renderSheet();
    fireEvent.click(screen.getByRole('tab', { name: 'Income' }));
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-01-05' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Paycheck' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Primary Earned Income' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add $500 to Primary Earned Income' }));
    await waitFor(() =>
      expect(transactions.save).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 500, category_id: 'inc1' }),
      ),
    );
  });

  // The amount is the one thing someone always knows when they open the
  // sheet. Requiring a date and a note as well put three fields between
  // them and logging the coffee they just bought.
  it('needs only an amount: the date falls back to today and the note to the category', async () => {
    const { transactions } = renderSheet();
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '4.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Housing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add $4.5 to Housing' }));
    await waitFor(() =>
      expect(transactions.save).toHaveBeenCalledWith(
        expect.objectContaining({ date: '2026-01-01', description: 'Housing', amount: -4.5 }),
      ),
    );
  });

  it('will not submit without an amount', () => {
    renderSheet();
    expect(screen.getByRole('button', { name: 'Add expense' })).toBeDisabled();
  });

  // Tapping the selected chip clears it: an uncategorized transaction is
  // an honest record, and better than a wrong one filed to get out of
  // the sheet.
  it('saves without a category when none is chosen', async () => {
    const { transactions } = renderSheet();
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Housing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Housing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add $12' }));
    await waitFor(() =>
      expect(transactions.save).toHaveBeenCalledWith(
        expect.objectContaining({ category_id: null, description: 'Expense' }),
      ),
    );
  });

  it('opens on the requested method rather than always Manual', () => {
    renderSheet({ initialMethod: 'csv' });
    expect(screen.getByRole('tab', { name: 'Import CSV' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('offers a Voice tab that shows the mic control without touching the microphone until tapped', () => {
    renderSheet();
    fireEvent.click(screen.getByRole('tab', { name: 'Voice' }));
    expect(screen.getByRole('button', { name: 'Tap to speak' })).toBeInTheDocument();
  });
});

const EDITING = {
  id: 'tx1',
  date: '2026-01-05',
  description: 'STARBUCKS #4021 SINGAPORE',
  amount: -8.5,
  category_id: 'exp1',
};

describe('AddTransactionSheet editing an existing transaction', () => {
  it('opens on the transaction, with the sign already split off the amount', async () => {
    renderSheet({ editing: EDITING });
    expect(await screen.findByDisplayValue('8.5')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toHaveValue('STARBUCKS #4021 SINGAPORE');
    expect(screen.getByLabelText('Date')).toHaveValue('2026-01-05');
    expect(screen.getByRole('tab', { name: 'Expense' })).toHaveAttribute('aria-selected', 'true');
  });

  // Every other method creates a row; none of them edits this one.
  it('offers no entry methods, since only the manual form can correct a row', async () => {
    renderSheet({ editing: EDITING });
    await screen.findByDisplayValue('8.5');
    expect(screen.queryByRole('tab', { name: 'Import CSV' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Receipt' })).not.toBeInTheDocument();
    expect(screen.getByText('Edit transaction')).toBeInTheDocument();
  });

  // The whole point of an edit: one row corrected, not a near-duplicate
  // left beside the original.
  it('saves over the same id rather than creating a second transaction', async () => {
    const { transactions } = renderSheet({ editing: EDITING });
    await screen.findByDisplayValue('8.5');
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '9.25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(transactions.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tx1', amount: -9.25 }),
      ),
    );
  });

  it('keeps income income when the amount is edited', async () => {
    const { transactions } = renderSheet({
      editing: { ...EDITING, amount: 2400, category_id: 'inc1' },
    });
    // NumberField groups thousands for display; the draft holds 2400.
    await screen.findByDisplayValue('2,400');
    expect(screen.getByRole('tab', { name: 'Income' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(transactions.save).toHaveBeenCalledWith(expect.objectContaining({ amount: 2400 })),
    );
  });

  it('proposes a rule keyword from the description, and lets it be edited before saving', async () => {
    const rules = { items: [], save: vi.fn() };
    renderSheet({ editing: EDITING, rules });
    expect(await screen.findByDisplayValue('starbucks')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Keyword'), { target: { value: 'starbucks sg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    await waitFor(() =>
      expect(rules.save).toHaveBeenCalledWith(
        expect.objectContaining({ keyword: 'starbucks sg', category_id: 'exp1' }),
      ),
    );
    expect(await screen.findByText(/now files under/)).toBeInTheDocument();
  });

  // The picker always has something selected, but on an uncategorized
  // row that is the ranking's suggestion, not an answer. A rule seeded
  // from a guess misfiles every future import, so the offer waits until
  // a category is actually tapped.
  it('waits for a category to be chosen before offering a rule', async () => {
    renderSheet({ editing: { ...EDITING, category_id: null } });
    await screen.findByDisplayValue('8.5');
    expect(screen.queryByText('Make a rule from this')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Housing' }));
    expect(await screen.findByText('Make a rule from this')).toBeInTheDocument();
  });

  it('makes no rule offer when adding a new transaction', () => {
    renderSheet();
    expect(screen.queryByText('Make a rule from this')).not.toBeInTheDocument();
  });
});

/**
 * Creating a category was only possible on More's Categories screen,
 * which meant a transaction whose category didn't exist yet had to be
 * abandoned and retyped. The rule for what a typed name resolves to
 * lives in `budget_calc::resolve_category_name`; what matters here is
 * that the sheet keeps the half-entered transaction while it happens.
 */
describe('AddTransactionSheet category creation', () => {
  const CREATING_WASM = {
    ...WASM,
    preset_categories: async () => [],
    resolve_category_name: async ({ typed, direction, presets }) => {
      const wantsIncome = direction === 'income';
      const needle = typed.trim().toLowerCase();
      const presetMatch = presets.find(
        (p) => p.is_income === wantsIncome && p.name.toLowerCase() === needle,
      );
      if (presetMatch) return { outcome: 'preset', preset_key: presetMatch.key };
      return {
        outcome: 'create',
        name: typed.trim(),
        group_key: wantsIncome ? 'cat.group.income' : 'cat.group.expense',
        error: null,
      };
    },
  };

  /**
   * A category store that actually holds what it is given, unlike a
   * `vi.fn()` save. The whole point of creating one here is that the
   * picker then has it to select and the submit button has it to name --
   * against a store that forgets, every one of those assertions would
   * pass vacuously or fail for the wrong reason.
   */
  function renderCreatingSheet(wasmModule = CREATING_WASM) {
    const transactions = { items: [], save: vi.fn() };
    const saved = [];
    function Harness() {
      const [items, setItems] = React.useState(CATEGORIES.items);
      const categories = {
        items,
        save: async (record) => {
          saved.push(record);
          setItems((prev) => [...prev, record]);
        },
      };
      return (
        <I18nProvider initialLocale="en">
          <AddTransactionSheet
            open
            onClose={() => {}}
            wasmModule={wasmModule}
            newId={() => 'new-id'}
            today="2026-01-01"
            categories={categories}
            rules={{ items: [] }}
            transactions={transactions}
            recurring={{ items: [] }}
            formatMoney={(n) => `$${n}`}
          />
        </I18nProvider>
      );
    }
    render(<Harness />);
    return { saved, transactions };
  }

  it('creates a category from the picker and files the transaction under it', async () => {
    const { saved, transactions } = renderCreatingSheet();
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '42.60' } });

    fireEvent.click(screen.getByRole('button', { name: '+ New' }));
    fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Pets' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create “Pets”' }));

    await waitFor(() => expect(saved).toContainEqual(expect.objectContaining({ name: 'Pets' })));
    expect(saved[0].is_income).toBe(false);

    // The amount typed before the detour is still there, and the new
    // category is selected -- the submit button naming both is the
    // evidence that nothing had to be re-entered.
    const submit = await screen.findByRole('button', { name: 'Add $42.6 to Pets' });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(transactions.save).toHaveBeenCalledWith(
        expect.objectContaining({ amount: -42.6, category_id: 'new-id' }),
      ),
    );
  });

  it('creates on the income side when the sheet is in Income mode', async () => {
    const { saved } = renderCreatingSheet();
    fireEvent.click(screen.getByRole('tab', { name: 'Income' }));
    fireEvent.click(screen.getByRole('button', { name: '+ New' }));
    fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Dividends' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create “Dividends”' }));
    await waitFor(() =>
      expect(saved).toContainEqual(expect.objectContaining({ name: 'Dividends', is_income: true })),
    );
  });

  // Nothing left to add by hand -- no presets seeded here -- so typing is
  // the only path, and jumping straight to the keyboard saves a tap.
  it('autofocuses the name field when there is nothing to pick from instead', async () => {
    renderCreatingSheet();
    fireEvent.click(screen.getByRole('button', { name: '+ New' }));
    // The preset fetch is async even though it resolves to an empty list,
    // and the field remounts once that settles -- see `presetsReady` on
    // `useCreateCategory` -- so the correct autofocus decision can lag the
    // click by a tick rather than land immediately.
    await waitFor(() => expect(screen.getByLabelText('Category name')).toHaveFocus());
  });

  it('offers to create the name typed into the filter when nothing matches it', async () => {
    // The moment somebody has already said what they want and been told
    // it does not exist is the moment the offer is worth most.
    const many = Array.from({ length: 7 }, (_, i) => ({
      id: `exp${i}`,
      name: `Expense ${i}`,
      is_income: false,
    }));
    renderSheet({ wasmModule: CREATING_WASM, categories: { items: many, save: vi.fn() } });
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.change(screen.getByLabelText('Find a category'), { target: { value: 'Vet' } });
    expect(await screen.findByText('No category matches that.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create “Vet”' }));
    // Opens the name field already holding what was typed, rather than
    // asking for it a second time.
    expect(screen.getByLabelText('Category name')).toHaveValue('Vet');
    // The keyboard was already up for the filter box this came from, so
    // moving focus into the field it opens summons nothing new -- unlike
    // "+ New", this path keeps autofocus regardless of any presets on
    // offer.
    expect(screen.getByLabelText('Category name')).toHaveFocus();
  });

  // Sixteen starter presets already exist; a typed-name-only field is
  // only easier than More -> Categories for a name that isn't one of
  // them. This is the gap CategoryPicker closed alongside Budget's own.
  it('offers an unadded preset as a chip, and creates it furnished on a tap', async () => {
    const PRESET = {
      key: 'cat.subscriptionsMemberships',
      group_key: 'cat.group.expense',
      description_key: 'cat.subscriptionsMemberships.desc',
      is_income: false,
    };
    const wasmModule = { ...CREATING_WASM, preset_categories: async () => [PRESET] };
    const { saved } = renderCreatingSheet(wasmModule);

    fireEvent.click(screen.getByRole('button', { name: '+ New' }));
    const chip = await screen.findByRole('button', { name: 'Subscriptions & Memberships' });
    // The bug this was caught on: opening this field used to steal the
    // keyboard unconditionally, which on a real phone shoved the nav bar
    // mid-screen and hid the very chip being asserted on above, behind it.
    expect(screen.getByLabelText('Category name')).not.toHaveFocus();
    fireEvent.click(chip);

    await waitFor(() =>
      expect(saved).toContainEqual(
        expect.objectContaining({
          name: 'Subscriptions & Memberships',
          preset_key: 'cat.subscriptionsMemberships',
        }),
      ),
    );
    // Selected, exactly as a typed-and-created category would be.
    expect(await screen.findByRole('button', { name: /Subscriptions & Memberships/ })).toHaveClass(
      'active',
    );
  });
});

/**
 * The Recurring tab's desktop rows. Everything here asserts on the
 * batch shape; the phone's single draft form is the `isDesktop: false`
 * default the rest of this file renders, and the last case checks it is
 * still what a narrow screen gets.
 */
describe('AddTransactionSheet recurring rows (desktop)', () => {
  const renderRecurring = (props) => {
    const recurring = { items: [], save: vi.fn() };
    const onClose = vi.fn();
    const utils = renderSheet({ isDesktop: true, recurring, onClose, ...props });
    fireEvent.click(screen.getByRole('tab', { name: 'Recurring' }));
    return { ...utils, recurring, onClose };
  };

  const fillRow = (n, { description, category = 'exp1', amount, date }) => {
    fireEvent.change(screen.getByLabelText(`Description, row ${n}`), {
      target: { value: description },
    });
    fireEvent.change(screen.getByLabelText(`Category, row ${n}`), { target: { value: category } });
    fireEvent.change(screen.getByLabelText(`Amount per occurrence, row ${n}`), {
      target: { value: amount },
    });
    fireEvent.change(screen.getByLabelText(`One real due date, row ${n}`), {
      target: { value: date },
    });
  };

  it('shows one empty row with the columns named once in the header', () => {
    renderRecurring();
    expect(screen.getByLabelText('Description, row 1')).toBeInTheDocument();
    expect(screen.queryByLabelText('Description, row 2')).not.toBeInTheDocument();
    expect(screen.getByText('Repeats')).toBeInTheDocument();
  });

  it('grows a fresh row once the last one has a description', () => {
    renderRecurring();
    fireEvent.change(screen.getByLabelText('Description, row 1'), { target: { value: 'Rent' } });
    expect(screen.getByLabelText('Description, row 2')).toBeInTheDocument();
  });

  it('saves every complete row in one submit', async () => {
    const { recurring } = renderRecurring();
    fillRow(1, { description: 'Rent', amount: '2400', date: '2026-01-01' });
    fillRow(2, { description: 'Phone', amount: '45', date: '2026-01-08' });

    fireEvent.click(screen.getByRole('button', { name: 'Add 2 recurring expenses' }));

    await waitFor(() => expect(recurring.save).toHaveBeenCalledTimes(2));
    expect(recurring.save).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Rent', amount: 2400, anchor_date: '2026-01-01' }),
    );
    expect(recurring.save).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Phone', amount: 45, category_id: 'exp1' }),
    );
  });

  it('defaults the cadence to monthly and saves the one that was picked', async () => {
    const { recurring } = renderRecurring();
    fillRow(1, { description: 'Rent', amount: '2400', date: '2026-01-01' });
    expect(screen.getByLabelText('Repeats, row 1')).toHaveValue('monthly');
    fireEvent.change(screen.getByLabelText('Repeats, row 1'), { target: { value: 'yearly' } });

    fireEvent.click(screen.getByRole('button', { name: 'Add recurring expense' }));
    await waitFor(() =>
      expect(recurring.save).toHaveBeenCalledWith(expect.objectContaining({ cadence: 'yearly' })),
    );
  });

  it('keeps the submit disabled until a row has every field the phone form needs', () => {
    renderRecurring();
    const submit = screen.getByRole('button', { name: 'Add recurring expense' });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Description, row 1'), { target: { value: 'Rent' } });
    fireEvent.change(screen.getByLabelText('Amount per occurrence, row 1'), {
      target: { value: '2400' },
    });
    expect(submit).toBeDisabled(); // no category, no due date yet

    fireEvent.change(screen.getByLabelText('Category, row 1'), { target: { value: 'exp1' } });
    fireEvent.change(screen.getByLabelText('One real due date, row 1'), {
      target: { value: '2026-01-01' },
    });
    expect(submit).toBeEnabled();
  });

  it('closes the sheet on a clean batch but keeps an unfinished row open', async () => {
    const { recurring, onClose } = renderRecurring();
    fillRow(1, { description: 'Rent', amount: '2400', date: '2026-01-01' });
    // Started but missing its due date: saving must not take it, and
    // closing the sheet would throw it away with no report.
    fireEvent.change(screen.getByLabelText('Description, row 2'), { target: { value: 'Gym' } });

    fireEvent.click(screen.getByRole('button', { name: 'Add recurring expense' }));

    await waitFor(() => expect(recurring.save).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Description, row 1')).toHaveValue('Gym');

    fillRow(1, { description: 'Gym', amount: '60', date: '2026-01-15' });
    fireEvent.click(screen.getByRole('button', { name: 'Add recurring expense' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('adds a row on Shift+Enter and moves to an existing one below', () => {
    renderRecurring();
    const first = screen.getByLabelText('Description, row 1');
    fireEvent.keyDown(first, { key: 'Enter', shiftKey: true });

    const second = screen.getByLabelText('Description, row 2');
    expect(second).toHaveFocus();

    // Back up a row, and the shortcut should land on the row that
    // already exists rather than appending a third.
    fireEvent.keyDown(first, { key: 'Enter', shiftKey: true });
    expect(second).toHaveFocus();
    expect(screen.queryByLabelText('Description, row 3')).not.toBeInTheDocument();
  });

  it('removes a row, and never the last one', () => {
    renderRecurring();
    fireEvent.change(screen.getByLabelText('Description, row 1'), { target: { value: 'Rent' } });
    expect(screen.getByRole('button', { name: 'Remove row 2' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove row 2' }));
    expect(screen.queryByLabelText('Description, row 2')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove row 1' })).toBeDisabled();
  });

  it('leaves the phone on its single draft form', () => {
    renderSheet({ isDesktop: false });
    fireEvent.click(screen.getByRole('tab', { name: 'Recurring' }));
    expect(screen.queryByLabelText('Description, row 1')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add recurring expense' })).toBeInTheDocument();
  });
});

describe('AddTransactionSheet CSV import', () => {
  // The header names are matched in Rust (`detect_columns`); what these
  // cover is the half that can't be: that the picker offers the file's own
  // columns by name, that it stays reachable when the guess did land, and
  // that a split debit/credit export has somewhere to say so.
  const CSV = 'Date,Payee,Debit,Credit\n2026-08-01,COFFEE,4.50,\n2026-08-02,SALARY,,3000.00\n';

  const COLUMNS = [
    { index: 0, header: 'Date', sample: '2026-08-01' },
    { index: 1, header: 'Payee', sample: 'COFFEE' },
    { index: 2, header: 'Debit', sample: '4.50' },
    { index: 3, header: 'Credit', sample: '3000.00' },
  ];

  const csvWasm = (detected) => ({
    ...WASM,
    detect_csv_columns: vi.fn(async () => ({ mapping: detected, columns: COLUMNS })),
    csv_columns: vi.fn(async () => ({ mapping: null, columns: COLUMNS })),
    import_csv: vi.fn(async () => ({ imported: [], skipped: [], date_format: 'DD/MM/YYYY' })),
  });

  const dropFile = async (wasm) => {
    const utils = renderSheet({ initialMethod: 'csv', wasmModule: wasm });
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, {
      target: { files: [new File([CSV], 'statement.csv', { type: 'text/csv' })] },
    });
    // The file is read asynchronously and the picker only exists once the
    // columns come back from the (mocked) detect call.
    await screen.findByLabelText('Date column');
    return utils;
  };

  it('offers each column by its header and a real value from it', async () => {
    await dropFile(csvWasm(null));
    const options = [...screen.getByLabelText('Date column').options].map((o) => o.textContent);
    expect(options).toEqual([
      '1 · Date (2026-08-01)',
      '2 · Payee (COFFEE)',
      '3 · Debit (4.50)',
      '4 · Credit (3000.00)',
    ]);
  });

  it('lets a split debit/credit export name its money-in column', async () => {
    await dropFile(csvWasm(null));
    const credit = screen.getByLabelText('Money-in column (only if separate)');
    // Its own option, so "this file has one column, signed" stays sayable.
    expect(credit.value).toBe('');
    fireEvent.change(credit, { target: { value: '3' } });
    expect(credit.value).toBe('3');
  });

  it('keeps the picker reachable when the columns were detected', async () => {
    // A guess that lands on the wrong column is as wrong as no guess, and
    // only the person looking at the file can see that it did.
    const detected = {
      date_col: 0,
      description_col: 1,
      amount_col: 2,
      credit_col: 3,
      has_header: true,
    };
    await dropFile(csvWasm(detected));
    expect(screen.getByText('Columns matched automatically from the header row.')).toBeTruthy();
    expect(screen.getByLabelText('Amount column').value).toBe('2');
  });

  it('re-reads the columns when the header row answer changes', async () => {
    const wasm = csvWasm(null);
    await dropFile(wasm);
    fireEvent.click(screen.getByLabelText('First row is a header'));
    await waitFor(() =>
      expect(wasm.csv_columns).toHaveBeenCalledWith({ csv_text: CSV, has_header: false }),
    );
  });

  it('says which way an ambiguous date column was read', async () => {
    const wasm = csvWasm(null);
    await dropFile(wasm);
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(
      await screen.findByText('Dates read as DD/MM/YYYY — worth checking a row or two.'),
    ).toBeTruthy();
  });
});
