import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import useIsDesktop from '../useIsDesktop';
import { makeFormatMoney } from '../currency';
import CategoryBadge from './CategoryBadge';
import CategoryChipPicker from './CategoryChipPicker';
import CategoryRows from './CategoryRows';
import {
  DEBT_PREFIX,
  GOAL_PREFIX,
  isCommitmentId,
  loadIncludeCommitments,
  saveIncludeCommitments,
} from '../commitments';
import { SAVINGS_CATEGORY_ID, totalExpenseActual } from '../savings';
import {
  availablePresets,
  categoryDisplayDescription,
  categoryDisplayGroup,
  categoryDisplayName,
} from '../presetCategories';
import { useMonthBudget } from '../useMonthBudget';

/**
 * Everything BudgetTab's old four-column grid carried besides the row
 * list itself: creating/removing categories, the method explainer,
 * whether goals/debt count against this month, and the Savings target --
 * see the plan's own ledger: "Category management, commitments and the
 * Savings row move to More." None of it is a daily action the way
 * assigning a planned amount is, so it lives one tap behind "Categories"
 * in More rather than permanently on Budget.
 *
 * Reuses `useMonthBudget` -- the same `budget_calc::build_month` call
 * BudgetTab's row list runs -- for the two things this screen still needs
 * numbers for: the commitments table's contribution amounts, and the
 * Savings row's actual/remaining. See that hook's own doc comment for why
 * this is a shared hook rather than a second copy of its planned-list
 * trap.
 *
 * Two shapes for creating one, split on width, the same way
 * `RulesSection` is: desktop gets `CategoryRows`, because setting a
 * budget up means naming eight or ten categories in a sitting; the phone
 * keeps the single draft form, which is what fits 375px. Both save
 * through the same `saveCategory` below, so the group fallback and the
 * income flag cannot drift between them.
 */

let rowSeq = 0;
export const emptyCategoryRow = () => ({
  name: '',
  group: '',
  isIncome: false,
  key: `category-row-${(rowSeq += 1)}`,
});

export default function CategoriesScreen({
  wasmModule,
  newId,
  currencySymbol,
  viewMonth,
  categories,
  removeCategory,
  addCommonCategories,
  addPresetCategory,
  transactions,
  budgetPlan,
  goals,
  debts,
}) {
  const { t } = useI18n();
  const formatMoney = makeFormatMoney(currencySymbol);
  const [newCategory, setNewCategory] = useState({ name: '', group: '', isIncome: false });
  const [rows, setRows] = useState(() => [emptyCategoryRow()]);
  const [includeCommitments, setIncludeCommitments] = useState(() => loadIncludeCommitments());
  const [presetCategories, setPresetCategories] = useState([]);
  const [savingsResult, setSavingsResult] = useState(null);
  const [savingsDraft, setSavingsDraft] = useState(null);
  const isDesktop = useIsDesktop();

  const { result, isIncome } = useMonthBudget({
    wasmModule,
    categories,
    budgetPlan,
    transactions,
    viewMonth,
    includeCommitments,
    goals,
    debts,
  });

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!wasmModule?.build_savings_line || !result?.summary) {
        setSavingsResult(null);
        return;
      }
      const planned =
        budgetPlan.items.find((p) => p.category_id === SAVINGS_CATEGORY_ID)?.planned ?? 0;
      const expense = totalExpenseActual(result.lines ?? [], isIncome, isCommitmentId);
      const built = await wasmModule.build_savings_line({
        planned,
        income: result.summary.income,
        total_expense_actual: expense,
      });
      if (!cancelled) setSavingsResult(built);
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `isIncome` is derived fresh each render from `categories.items`, already a dep below.
  }, [wasmModule, result, budgetPlan.items, categories.items]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!wasmModule?.preset_categories) return;
      const presets = (await wasmModule.preset_categories()) ?? [];
      if (!cancelled) setPresetCategories(presets);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [wasmModule]);

  const savingsLine = savingsResult?.line;

  /** Same opposite-polarity reading as BudgetTab used to give the Savings
   *  row: meeting or beating the target is good news, falling short is a
   *  plain amount still to go. */
  const savingsRemainingCell = (line) => {
    const gap = line.spent - line.planned;
    if (gap >= 0) {
      return {
        className: 'positive',
        text: t('budget.receivedMore', { amount: formatMoney(gap) }),
      };
    }
    return { className: 'negative', text: formatMoney(gap) };
  };

  const commitmentLines = (result?.lines ?? [])
    .filter((l) => isCommitmentId(l.category_id))
    .map((line) => {
      const isGoal = line.category_id.startsWith(GOAL_PREFIX);
      const id = line.category_id.slice((isGoal ? GOAL_PREFIX : DEBT_PREFIX).length);
      const source = (isGoal ? goals?.items : debts?.items)?.find((r) => r.id === id);
      return { line, isGoal, name: source?.name ?? id };
    });

  // `newId` rather than a second copy of App's `wasmModule.new_id ?
  // ... : local-${Date.now()}` fallback -- App already passes exactly
  // that down here, and RulesSection has always used it.
  const saveCategory = async ({ name, group, isIncome }) => {
    await categories.save({
      id: newId(),
      name,
      // Same two groups `resolve_category_name` files a hand-typed
      // category under, so one created here and one created from the
      // picker or Budget don't land in different sections of the very
      // list that groups by this. ('General' used to be the expense
      // default -- untranslated, and a group nothing else ever used.)
      group: group || t(isIncome ? 'cat.group.income' : 'cat.group.expense'),
      is_income: isIncome,
    });
  };

  const addCategory = async (e) => {
    e.preventDefault();
    if (!newCategory.name.trim()) return;
    await saveCategory(newCategory);
    setNewCategory({ name: '', group: '', isIncome: false });
  };

  // A name in the last row grows a fresh row beneath it, the same way
  // RuleRows grows on a keyword: the next row is already there by the
  // time someone reaches for it, so "+ Add a row" is the fallback rather
  // than the step everyone takes.
  const setRow = (key, patch) => {
    setRows((current) => {
      const next = current.map((r) => (r.key === key ? { ...r, ...patch } : r));
      const last = next[next.length - 1];
      return last.name.trim() ? [...next, emptyCategoryRow()] : next;
    });
  };

  const addRow = () => setRows((current) => [...current, emptyCategoryRow()]);

  const removeRow = (key) =>
    setRows((current) => (current.length === 1 ? current : current.filter((r) => r.key !== key)));

  // A name is the whole of a category: the group has a documented
  // fallback and the direction defaults to expense, so a named row is
  // always complete.
  const namedRows = rows.filter((r) => r.name.trim());

  const addCategories = async (e) => {
    e.preventDefault();
    if (namedRows.length === 0) return;
    for (const row of namedRows) await saveCategory(row);
    setRows([emptyCategoryRow()]);
  };

  // Counts what will actually be saved, so the button never promises
  // more than the rows hold.
  const batchSubmitLabel = () =>
    namedRows.length > 1
      ? t('budget.addCategoryCount', { count: namedRows.length })
      : t('budget.addCategory');

  const saveSavingsPlanned = async (amount) => {
    const existing = budgetPlan.items.find((p) => p.category_id === SAVINGS_CATEGORY_ID);
    const id = existing?.id ?? (wasmModule?.new_id ? wasmModule.new_id() : `local-${Date.now()}`);
    await budgetPlan.save({
      id,
      month: viewMonth,
      category_id: SAVINGS_CATEGORY_ID,
      planned: Number(amount) || 0,
    });
  };

  return (
    <div className="panel">
      <h2 className="section-start">{t('budget.categoriesTitle')}</h2>

      {/* The method, stated once. Zero-based budgeting is the entire
          premise of Budget's row list and never said so there. */}
      <p className="panel-subtitle">{t('budget.method')}</p>

      {/* Off by default: a goal or debt only claims part of this month's
          income once someone says so, not because the feature exists. */}
      <label className="field-check commitments-toggle">
        <input
          type="checkbox"
          checked={includeCommitments}
          onChange={(e) => {
            setIncludeCommitments(e.target.checked);
            saveIncludeCommitments(e.target.checked);
          }}
        />
        <span>{t('budget.includeCommitments')}</span>
      </label>

      {categories.items.length === 0 ? (
        <p className="empty-state">{t('budget.noCategories')}</p>
      ) : (
        <div className="category-manage-list">
          {categories.items.map((c) => (
            <div className="category-manage-row" key={c.id}>
              <div className="category-manage-info">
                <div className="category-name">
                  <CategoryBadge category={c} />
                  {categoryDisplayName(c, t)}
                </div>
                <div className="category-group">
                  {categoryDisplayGroup(c, t)}
                  {categoryDisplayDescription(c, t) && ` · ${categoryDisplayDescription(c, t)}`}
                </div>
              </div>
              <button className="btn ghost" onClick={() => removeCategory(c.id)}>
                {t('budget.remove')}
              </button>
            </div>
          ))}
        </div>
      )}

      <CategoryChipPicker
        presets={availablePresets(presetCategories, categories.items, t)}
        onAdd={addPresetCategory}
      />
      {isDesktop ? (
        <form className="category-batch" onSubmit={addCategories}>
          <CategoryRows
            rows={rows}
            onRowChange={setRow}
            onAddRow={addRow}
            onRemoveRow={removeRow}
          />
          <div className="category-batch-actions">
            <button className="btn" type="submit" disabled={namedRows.length === 0}>
              {batchSubmitLabel()}
            </button>
            <button className="btn secondary" type="button" onClick={() => addCommonCategories()}>
              {t('budget.addCommon')}
            </button>
          </div>
        </form>
      ) : (
        <form className="form-grid" onSubmit={addCategory}>
          <label className="field">
            <span className="field-label">{t('budget.categoryName')}</span>
            <div className="field-input">
              <input
                value={newCategory.name}
                onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
              />
            </div>
          </label>
          <label className="field">
            <span className="field-label">{t('budget.categoryGroup')}</span>
            <div className="field-input">
              <input
                value={newCategory.group}
                onChange={(e) => setNewCategory({ ...newCategory, group: e.target.value })}
              />
            </div>
          </label>
          <label className="field field-check">
            <input
              type="checkbox"
              checked={newCategory.isIncome}
              onChange={(e) => setNewCategory({ ...newCategory, isIncome: e.target.checked })}
            />
            <span>{t('budget.categoryIsIncome')}</span>
          </label>
          <button className="btn" type="submit">
            {t('budget.addCategory')}
          </button>
          <button className="btn secondary" type="button" onClick={() => addCommonCategories()}>
            {t('budget.addCommon')}
          </button>
        </form>
      )}
      <p className="field-label">{t('budget.commonHint')}</p>

      {savingsLine && (
        <>
          <h2 className="section-start">{t('budget.savings')}</h2>
          <p className="panel-subtitle">{t('budget.savingsHint')}</p>
          <div className="category-manage-row category-row-savings">
            <div className="field-input planned-input">
              <span className="cell-label">{t('budget.planned')}</span>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                aria-label={`${t('budget.planned')} — ${t('budget.savings')}`}
                placeholder="0"
                value={savingsDraft ?? (savingsLine.planned || '')}
                onChange={(e) => {
                  setSavingsDraft(e.target.value);
                  saveSavingsPlanned(e.target.value);
                }}
              />
            </div>
            <div className="num spent-cell">
              <span className="cell-label">{t('budget.savingsActual')}</span>
              <span className="spent-value">{formatMoney(savingsLine.spent)}</span>
            </div>
            <div className={`num ${savingsRemainingCell(savingsLine).className}`}>
              <span className="cell-label">{t('budget.remaining')}</span>
              {savingsRemainingCell(savingsLine).text}
            </div>
          </div>
        </>
      )}

      {includeCommitments && commitmentLines.length > 0 && (
        <>
          <h2 className="section-start">{t('budget.commitmentsTitle')}</h2>
          <div className="category-manage-list">
            {commitmentLines.map(({ line, isGoal, name }) => (
              <div className="category-manage-row" key={line.category_id}>
                <div className="category-manage-info">
                  <div className="category-name">{name}</div>
                  <div className="category-group">
                    {isGoal ? t('goals.title') : t('debt.title')}
                  </div>
                </div>
                <div className="num">{formatMoney(line.planned)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
