import { useState } from 'react';

/**
 * The state behind every "type a batch into rows, save once" form.
 *
 * Four screens now use this shape -- transactions, rules, categories,
 * goals, debts -- and the first three each grew their own copy of the
 * same three reducers. They are small, which is exactly why they drifted
 * quietly: this repo has already shipped one bug from a shared component
 * being edited in one place and not the others (see CLAUDE.md on
 * `dash-header`). One implementation, one set of tests.
 *
 * `isFilled` is the caller's answer to "has this row been started?", and
 * it is what makes a fresh row appear underneath: a rules row counts as
 * started once it has a keyword, a transactions row once it has an
 * amount. Growing on that rather than on any keystroke is what stops a
 * blank row from being stranded above the caret.
 *
 * Deliberately *not* here: which rows are complete enough to save. That
 * differs per screen (a category needs only a name; a goal needs a name,
 * a target and a date) and belongs beside the save that enforces it.
 */
export default function useBatchRows({ emptyRow, isFilled }) {
  const [rows, setRows] = useState(() => [emptyRow()]);

  const setRow = (key, patch) => {
    setRows((current) => {
      const next = current.map((r) => (r.key === key ? { ...r, ...patch } : r));
      const last = next[next.length - 1];
      return isFilled(last) ? [...next, emptyRow()] : next;
    });
  };

  const addRow = () => setRows((current) => [...current, emptyRow()]);

  // Never the last one: removing it would leave nowhere to type.
  const removeRow = (key) =>
    setRows((current) => (current.length === 1 ? current : current.filter((r) => r.key !== key)));

  /**
   * After a save. `keep` is the rows that did not go in -- half-finished
   * ones the caller wants left on screen -- and a fresh trailing row
   * always comes back so the next entry has somewhere to land.
   */
  const reset = (keep = []) => setRows([...keep, emptyRow()]);

  return { rows, setRow, addRow, removeRow, reset };
}

/**
 * Row keys, unique across every batch form on the page. A key has to
 * survive the row being edited (React reconciliation) and be stable
 * enough to look a row up by, which rules out an index.
 */
let seq = 0;
export const rowKey = (prefix) => `${prefix}-row-${(seq += 1)}`;
