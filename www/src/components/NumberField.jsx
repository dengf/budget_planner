import React, { useState } from 'react';
import { useI18n } from '../i18n';

/**
 * A numeric input that can show thousands separators without fighting the
 * caret.
 *
 * `grouped` fields render `500,000` while idle and plain `500000` while
 * focused. Reformatting mid-keystroke means tracking and restoring the caret
 * across a string whose length changes as you type, which goes wrong in ways
 * users experience as the cursor jumping; swapping on focus sidesteps that
 * entirely and still gives readable figures at rest — which is when they are
 * being read.
 *
 * Grouped fields are `type="text"`, since `type="number"` rejects a value
 * containing commas outright. `inputMode="decimal"` keeps the numeric keypad
 * on mobile, and dropping `type="number"` also loses its habit of silently
 * changing the value when a scroll wheel passes over a focused field.
 *
 * `signed` adds a tap-to-flip +/- button for fields where the sign is the
 * decision (a transaction's spend-vs-income amount) rather than a typo to
 * avoid. `inputMode="decimal"`'s on-screen keypad drops the minus key on at
 * least one major mobile browser (reported live: iOS Safari shows no way to
 * type one at all), so a phone typing a plain positive number here would
 * silently save as income -- the toggle is a keyboard-independent way to set
 * the sign that works the same on every device, not a workaround for one.
 */
export default function NumberField({
  label,
  value,
  onChange,
  suffix,
  step = 'any',
  min,
  grouped = false,
  signed = false,
}) {
  const { t } = useI18n();
  const [focused, setFocused] = useState(false);

  if (!grouped) {
    return (
      <label className="field">
        <span className="field-label">{label}</span>
        <div className="field-input">
          <input
            type="number"
            value={value}
            step={step}
            min={min}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          />
          {suffix && <span className="field-suffix">{suffix}</span>}
        </div>
      </label>
    );
  }

  // Strip separators before parsing: `Number('500,000')` is NaN.
  const parse = (raw) => {
    const cleaned = String(raw).replace(/,/g, '').trim();
    if (cleaned === '') return '';
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : '';
  };

  const shown =
    focused || value === '' || value == null || !Number.isFinite(Number(value))
      ? value
      : Number(value).toLocaleString('en-US', { maximumFractionDigits: 10 });

  const isNegative = Number.isFinite(Number(value)) && Number(value) < 0;

  const flipSign = () => {
    if (value === '' || value == null || !Number.isFinite(Number(value))) return;
    onChange(-Number(value));
  };

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <div className="field-input">
        {signed && (
          <button
            type="button"
            className={`sign-toggle ${isNegative ? 'negative' : 'positive'}`}
            onClick={flipSign}
            aria-label={isNegative ? t('transactions.switchToIncome') : t('transactions.switchToSpending')}
          >
            {isNegative ? '−' : '+'}
          </button>
        )}
        <input
          type="text"
          inputMode="decimal"
          value={shown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            // Ignore anything that isn't a number under construction — a
            // stray letter would otherwise blank the field mid-word.
            const raw = e.target.value;
            if (raw !== '' && !/^-?[\d,]*\.?\d*$/.test(raw)) return;
            onChange(parse(raw));
          }}
        />
        {suffix && <span className="field-suffix">{suffix}</span>}
      </div>
    </label>
  );
}
