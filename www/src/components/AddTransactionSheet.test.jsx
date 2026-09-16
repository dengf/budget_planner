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
