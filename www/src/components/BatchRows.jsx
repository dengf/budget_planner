import React, { useEffect, useRef } from 'react';
import { useI18n } from '../i18n';

/**
 * The chrome around a batch-entry rows form: the header row that labels
 * the columns once, the Shift+Enter shortcut, and the "+ Add a row"
 * footer. The caller supplies the controls for one row via `children`,
 * and nothing about a goal, a debt or a rule is known here.
 *
 * Rendered only at desktop width -- every caller gates it behind
 * `isDesktop` and keeps its single-draft form for the phone, where three
 * or five columns of controls do not fit 375px.
 *
 * The grid itself is one CSS rule (`.batch-row`) reading a
 * `--batch-cols` custom property, so a caller sets its own column widths
 * by naming a modifier class and nothing else.
 */
export default function BatchRows({
  className,
  headers,
  rows,
  onAddRow,
  onRemoveRow,
  firstFieldSelector = 'input',
  children,
}) {
  const { t } = useI18n();
  const rowsRef = useRef(null);
  const focusNewRow = useRef(false);

  /**
   * Shift+Enter means "next row", so a batch can be typed without
   * leaving the keyboard. Plain Enter still submits the form -- the
   * browser's own behaviour, and the one people expect from a form --
   * which is exactly why the shortcut needs a modifier.
   *
   * It only *adds* a row when there isn't one below: starting the last
   * row already grows a fresh one underneath (see `useBatchRows`), so
   * appending unconditionally would leave a blank row stranded above the
   * caret every time.
   *
   * The handler sits on the container rather than on every input:
   * `keydown` bubbles, so one listener covers every control in every
   * row, including rows that don't exist yet.
   */
  const onKeyDown = (e) => {
    if (e.key !== 'Enter' || !e.shiftKey) return;
    const from = e.target.closest('.batch-row');
    if (!from) return;
    e.preventDefault();
    const all = [...(rowsRef.current?.querySelectorAll('.batch-row') ?? [])];
    const next = all[all.indexOf(from) + 1];
    if (next) {
      next.querySelector(firstFieldSelector)?.focus();
      return;
    }
    focusNewRow.current = true;
    onAddRow();
  };

  // Focus after React has committed the new row -- the input does not
  // exist yet at the moment the shortcut fires.
  useEffect(() => {
    if (!focusNewRow.current) return;
    focusNewRow.current = false;
    const fields = rowsRef.current?.querySelectorAll(`.batch-row ${firstFieldSelector}`);
    fields?.[fields.length - 1]?.focus();
  }, [rows.length, firstFieldSelector]);

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the rule guards against a div standing in for a control; nothing is activated here. This only listens for a shortcut bubbling out of the native inputs inside, each of which is already focusable and keyboard-operable on its own.
    <div className={`batch-rows ${className}`} ref={rowsRef} onKeyDown={onKeyDown}>
      {/* The headers are the column labels, stated once. Hidden from
          screen readers because every control inside a row names itself
          and its row number instead -- see each caller's `rowLabel`. */}
      <div className="batch-rows-head" aria-hidden="true">
        {headers.map((h) => (
          <span className="field-label" key={h}>
            {h}
          </span>
        ))}
        <span />
      </div>

      {rows.map((row, i) => (
        <div className="batch-row" key={row.key}>
          {children(row, i)}
          <button
            type="button"
            className="btn secondary batch-row-remove"
            aria-label={t('transactions.removeRow', { n: i + 1 })}
            onClick={() => onRemoveRow(row.key)}
            disabled={rows.length === 1}
          >
            &#215;
          </button>
        </div>
      ))}

      <div className="batch-rows-foot">
        <button type="button" className="btn secondary batch-rows-add" onClick={onAddRow}>
          + {t('transactions.addRow')}
        </button>
        {/* The shortcut is the fast path, so it is written down rather
            than left to be discovered -- and the button stays, because a
            shortcut nobody is obliged to know is not an affordance. */}
        <span className="field-label batch-rows-hint">{t('transactions.addRowShortcut')}</span>
      </div>
    </div>
  );
}
