import React from 'react';
import { useI18n } from '../i18n';

/**
 * A failure reported by the calculator core.
 *
 * Every result carries both an `error` sentence and an `error_message` code
 * with its values, so a translated UI can compose the sentence itself. Four
 * panels rendered the sentence -- which means a Chinese reader entering a
 * loan term of zero was told about it in English. This exists so there is
 * one place that gets the choice right rather than eight.
 */
export default function CalcError({ result }) {
  const { t } = useI18n();
  if (!result?.error) return null;
  return (
    <div className="error">
      {result.error_message
        ? t(result.error_message.code, result.error_message.params)
        : result.error}
    </div>
  );
}
