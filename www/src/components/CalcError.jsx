import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';

/**
 * A failure reported by the calculator core, or by App-level logic (e.g.
 * the category-delete guard).
 *
 * Renders as a toast fixed to the bottom of the viewport with
 * `role="alert"` (implies `aria-live="assertive"`) rather than inline in
 * document flow -- a validation error someone needs to notice regardless
 * of scroll position, not a paragraph they might never scroll to. Every
 * result still carries both an `error` sentence and an `error_message`
 * code with its values, so the translated UI composes the sentence itself
 * rather than showing whatever language Rust's fallback text happens to
 * be in.
 */
export default function CalcError({ result }) {
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState(false);

  // A new error (even with the same text) un-dismisses -- otherwise a
  // second failure after dismissing the first would render nothing.
  useEffect(() => {
    setDismissed(false);
  }, [result]);

  if (!result?.error || dismissed) return null;

  const message = result.error_message
    ? t(result.error_message.code, result.error_message.params)
    : result.error;

  return (
    <div className="toast-region" aria-live="assertive">
      <div className="toast" role="alert">
        <span className="toast-message">{message}</span>
        <button
          className="toast-dismiss"
          onClick={() => setDismissed(true)}
          aria-label={t('errors.dismiss')}
        >
          &times;
        </button>
      </div>
    </div>
  );
}
