import React, { useRef, useState } from 'react';
import { useI18n } from '../i18n';
import CategoryBadge from './CategoryBadge';
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
 */
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
  const isDesktop = useIsDesktop();
  const keywordRef = useRef(null);

  const submitRule = async () => {
    if (!ruleDraft.keyword.trim() || !ruleDraft.category_id) return;
    await rules.save({
      id: newId(),
      keyword: ruleDraft.keyword,
      category_id: ruleDraft.category_id,
      priority: Number(ruleDraft.priority) || 0,
    });
    setRuleDraft({ keyword: '', category_id: '', priority: 0 });
  };

  const addRule = (e) => {
    e.preventDefault();
    submitRule();
  };

  // Desktop-only: Shift+Enter saves the row in place and refocuses the
  // keyword field, so someone entering a batch of rules never has to reach
  // for the mouse between them. Plain Enter keeps its native behaviour.
  const handleRuleFieldKeyDown = (e) => {
    if (!isDesktop || e.key !== 'Enter' || !e.shiftKey) return;
    e.preventDefault();
    submitRule();
    keywordRef.current?.focus();
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
      <form className="form-grid" onSubmit={addRule}>
        <label className="field">
          <span className="field-label">{t('transactions.ruleKeyword')}</span>
          <div className="field-input">
            <input
              ref={keywordRef}
              value={ruleDraft.keyword}
              onChange={(e) => setRuleDraft({ ...ruleDraft, keyword: e.target.value })}
              onKeyDown={handleRuleFieldKeyDown}
            />
          </div>
        </label>
        <label className="field">
          <span className="field-label">{t('transactions.category')}</span>
          <select
            className="field-select"
            value={ruleDraft.category_id}
            onChange={(e) => setRuleDraft({ ...ruleDraft, category_id: e.target.value })}
            onKeyDown={handleRuleFieldKeyDown}
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
              onKeyDown={handleRuleFieldKeyDown}
            />
          </div>
        </label>
        <button className="btn" type="submit">
          {t('transactions.addRule')}
        </button>
        <button className="btn secondary" type="button" onClick={applyRules}>
          {t('transactions.applyRules')}
        </button>
        {/* Written down rather than left to be discovered, same reasoning
            as TransactionRows' own hint next to its "+ Add row" button. */}
        {isDesktop && <span className="field-label">{t('transactions.addRowShortcut')}</span>}
      </form>
    </div>
  );
}
