import React, { useState } from 'react';
import { useI18n } from '../i18n';
import CategoryBadge from './CategoryBadge';
import RuleRows from './RuleRows';
import { categoryDisplayName, makeCategoryLookup } from '../presetCategories';
import useIsDesktop from '../useIsDesktop';

/**
 * Categorization rules -- keyword in, category out.
 *
 * Lifted out of the Transactions tab, where it sat collapsed at the
 * bottom under the history list. It is setup, not daily use: a rule is
 * written once and then does its work silently every time a transaction
 * is added, so it belongs with the other things someone configures and
 * walks away from. Transactions is now just the list.
 *
 * The matching itself is `budget_calc::apply_rules`, called through the
 * wasm bridge -- this screen only collects the keyword, the category and
 * the priority, and asks for a re-run over existing history.
 *
 * Two shapes, one per width. Desktop gets `RuleRows`: rules are written
 * in batches off a bank export, and one draft row meant a dozen separate
 * save-and-retype cycles. The phone keeps the single draft form -- three
 * columns of controls do not fit 375px, and the batch case is a desk
 * case anyway. Both save through the same `saveRule` below.
 */

let rowSeq = 0;
export const emptyRuleRow = () => ({
  keyword: '',
  category_id: '',
  priority: '0',
  key: `rule-row-${(rowSeq += 1)}`,
});

const isComplete = (row) => !!row.keyword.trim() && !!row.category_id;
const isBlank = (row) => !row.keyword.trim() && !row.category_id;

export default function RulesSection({
  wasmModule,
  newId,
  confirm,
  categories,
  transactions,
  rules,
}) {
  const { t } = useI18n();
  const { categoryFor, categoryName } = makeCategoryLookup(categories.items, t);
  const [ruleDraft, setRuleDraft] = useState({ keyword: '', category_id: '', priority: 0 });
  const [rows, setRows] = useState(() => [emptyRuleRow()]);
  const isDesktop = useIsDesktop();

  const saveRule = ({ keyword, category_id, priority }) =>
    rules.save({
      id: newId(),
      keyword,
      category_id,
      priority: Number(priority) || 0,
    });

  const addRule = async (e) => {
    e.preventDefault();
    if (!ruleDraft.keyword.trim() || !ruleDraft.category_id) return;
    await saveRule(ruleDraft);
    setRuleDraft({ keyword: '', category_id: '', priority: 0 });
  };

  // A keyword in the last row grows a fresh row beneath it, the same way
  // TransactionRows grows on an amount: the next row is already there by
  // the time someone reaches for it, so "+ Add a row" is the fallback
  // rather than the step everyone takes.
  const setRow = (key, patch) => {
    setRows((current) => {
      const next = current.map((r) => (r.key === key ? { ...r, ...patch } : r));
      const last = next[next.length - 1];
      return last.keyword.trim() ? [...next, emptyRuleRow()] : next;
    });
  };

  const addRow = () => setRows((current) => [...current, emptyRuleRow()]);

  const removeRow = (key) =>
    setRows((current) => (current.length === 1 ? current : current.filter((r) => r.key !== key)));

  const completeRows = rows.filter(isComplete);

  /**
   * Saves every finished row in one pass.
   *
   * Half-finished rows -- a keyword with no category yet -- are kept
   * rather than saved or silently dropped: they are the rows still
   * needing a decision, and leaving them on screen is the only honest
   * report of what did and didn't go in. Fully blank rows go, and a
   * fresh trailing row always comes back so the next keyword has
   * somewhere to land.
   */
  const addRules = async (e) => {
    e.preventDefault();
    if (completeRows.length === 0) return;
    for (const row of completeRows) await saveRule(row);
    setRows((current) => {
      const left = current.filter((r) => !isComplete(r) && !isBlank(r));
      return [...left, emptyRuleRow()];
    });
  };

  const applyRules = async () => {
    if (!wasmModule?.apply_rules) return;
    const result = await wasmModule.apply_rules({
      transactions: transactions.items,
      rules: rules.items,
    });
    if (!result?.error) {
      for (const tx of result.transactions) {
        const before = transactions.items.find((item) => item.id === tx.id);
        if (before?.category_id !== tx.category_id) await transactions.save(tx);
      }
    }
  };

  const removeRule = async (rule) => {
    const ok = await confirm(t('confirm.removeRule', { keyword: rule.keyword }));
    if (ok) await rules.remove(rule.id);
  };

  // Counts what will actually be saved, so the button never promises more
  // than the rows hold -- the same call `TransactionBatchForm` makes.
  const batchSubmitLabel = () =>
    completeRows.length > 1
      ? t('transactions.addRuleCount', { count: completeRows.length })
      : t('transactions.addRule');

  return (
    <div className="panel">
      <h2>{t('transactions.rulesTitle')}</h2>
      <p className="panel-subtitle">{t('transactions.rulesHint')}</p>
      {rules.items.length === 0 ? (
        <p className="empty-state">{t('transactions.noRules')}</p>
      ) : (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>{t('transactions.ruleKeyword')}</th>
                <th>{t('transactions.category')}</th>
                <th>{t('transactions.rulePriority')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rules.items.map((r) => (
                <tr key={r.id}>
                  <td>{r.keyword}</td>
                  <td>
                    <span className="category-cell">
                      <CategoryBadge category={categoryFor(r.category_id)} />
                      {categoryName(r.category_id)}
                    </span>
                  </td>
                  <td className="num">{r.priority}</td>
                  <td>
                    <button className="btn ghost" onClick={() => removeRule(r)}>
                      {t('budget.remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {isDesktop ? (
        <form className="rule-batch" onSubmit={addRules}>
          <RuleRows
            rows={rows}
            categories={categories.items}
            onRowChange={setRow}
            onAddRow={addRow}
            onRemoveRow={removeRow}
          />
          <div className="rule-batch-actions">
            <button className="btn" type="submit" disabled={completeRows.length === 0}>
              {batchSubmitLabel()}
            </button>
            <button className="btn secondary" type="button" onClick={applyRules}>
              {t('transactions.applyRules')}
            </button>
          </div>
        </form>
      ) : (
        <form className="form-grid" onSubmit={addRule}>
          <label className="field">
            <span className="field-label">{t('transactions.ruleKeyword')}</span>
            <div className="field-input">
              <input
                value={ruleDraft.keyword}
                onChange={(e) => setRuleDraft({ ...ruleDraft, keyword: e.target.value })}
              />
            </div>
          </label>
          <label className="field">
            <span className="field-label">{t('transactions.category')}</span>
            <select
              className="field-select"
              value={ruleDraft.category_id}
              onChange={(e) => setRuleDraft({ ...ruleDraft, category_id: e.target.value })}
            >
              <option value="">&#8212;</option>
              {categories.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryDisplayName(c, t)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">{t('transactions.rulePriority')}</span>
            <div className="field-input">
              <input
                type="number"
                value={ruleDraft.priority}
                onChange={(e) => setRuleDraft({ ...ruleDraft, priority: e.target.value })}
              />
            </div>
          </label>
          <button className="btn" type="submit">
            {t('transactions.addRule')}
          </button>
          <button className="btn secondary" type="button" onClick={applyRules}>
            {t('transactions.applyRules')}
          </button>
        </form>
      )}
    </div>
  );
}
