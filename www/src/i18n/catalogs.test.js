import { describe, expect, it } from 'vitest';
import en from './en';
import zhHans from './zh-Hans';
import zhHant from './zh-Hant';
import { DEFAULT_LOCALE, LOCALES, matchLocale, translate } from './index.jsx';

const TRANSLATIONS = { 'zh-Hans': zhHans, 'zh-Hant': zhHant };

function placeholders(template) {
  return new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
}

describe('catalogs', () => {
  it.each(Object.keys(TRANSLATIONS))('%s covers every English key', (locale) => {
    const missing = Object.keys(en).filter((k) => !(k in TRANSLATIONS[locale]));
    expect(missing).toEqual([]);
  });

  it.each(Object.keys(TRANSLATIONS))('%s has no keys English lacks', (locale) => {
    const extra = Object.keys(TRANSLATIONS[locale]).filter((k) => !(k in en));
    expect(extra).toEqual([]);
  });

  it.each(Object.keys(TRANSLATIONS))('%s interpolates the same values as English', (locale) => {
    const mismatched = Object.entries(en)
      .filter(([key, english]) => {
        const translated = TRANSLATIONS[locale][key];
        if (typeof translated !== 'string') return false;
        const a = placeholders(english);
        const b = placeholders(translated);
        return a.size !== b.size || [...a].some((p) => !b.has(p));
      })
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });

  it('every locale offered in the switcher has a catalog', () => {
    for (const { id } of LOCALES) {
      expect(translate(id, 'app.title')).toBeTruthy();
    }
  });
});

describe('matchLocale', () => {
  it('reads the script subtag when one is present', () => {
    expect(matchLocale('zh-Hans-SG')).toBe('zh-Hans');
    expect(matchLocale('zh-Hant-TW')).toBe('zh-Hant');
  });

  it('treats Taiwan, Hong Kong and Macau as Traditional', () => {
    expect(matchLocale('zh-TW')).toBe('zh-Hant');
    expect(matchLocale('zh-HK')).toBe('zh-Hant');
  });

  it('treats other Chinese regions as Simplified', () => {
    expect(matchLocale('zh-CN')).toBe('zh-Hans');
    expect(matchLocale('zh-SG')).toBe('zh-Hans');
  });

  it('ignores languages it has no catalog for', () => {
    expect(matchLocale('fr-FR')).toBeNull();
    expect(matchLocale(undefined)).toBeNull();
  });
});

describe('translate', () => {
  it('interpolates named values', () => {
    expect(translate('en', 'debt.monthsToDebtFree', { months: 12 })).toBe('12 months to debt-free');
  });

  it('falls back to English rather than rendering blank', () => {
    expect(translate('zh-Hans', '__missing__')).toBe('__missing__');
    expect(translate('en', 'app.title')).toBe(en['app.title']);
  });

  it('leaves an unmatched placeholder visible instead of blanking it', () => {
    expect(translate('en', 'debt.monthsToDebtFree', {})).toContain('{months}');
  });

  it('falls back to the default locale for an unknown one', () => {
    expect(translate('xx-YY', 'app.title')).toBe(en['app.title']);
    expect(DEFAULT_LOCALE).toBe('en');
  });
});

// UTF-8 bytes decoded as Latin-1 turn every CJK character into a run of
// Latin-1 supplement characters. No catalog here legitimately contains any
// character in that range, so its presence is proof of a mis-encoded write.
const MOJIBAKE = /[-ÿ]/;
const CJK = /[　-〿一-鿿＀-￯]/;
const PROSE = /^(intro|meta|dashboard)\./;

// An email address example is the same shape in every locale -- same
// category as untranslated-strings.test.js's BRAND exemption for
// 'meifio': identical everywhere, so a Chinese catalog carrying the
// English placeholder verbatim is correct, not a missed translation.
const PROSE_EXEMPT = new Set(['dashboard.recipientsPlaceholder']);

describe('catalog encoding', () => {
  it.each(Object.keys(TRANSLATIONS))('%s survived the file round-trip intact', (locale) => {
    const corrupted = Object.entries(TRANSLATIONS[locale])
      .filter(([, value]) => MOJIBAKE.test(value))
      .map(([key]) => key);
    expect(corrupted).toEqual([]);
  });

  it('holds English to the same encoding rule', () => {
    const corrupted = Object.entries(en)
      .filter(([, value]) => MOJIBAKE.test(value))
      .map(([key]) => key);
    expect(corrupted).toEqual([]);
  });

  it.each(Object.keys(TRANSLATIONS))('%s actually contains Chinese', (locale) => {
    const chinese = Object.values(TRANSLATIONS[locale]).filter((v) => CJK.test(v));
    expect(chinese.length).toBeGreaterThan(Object.keys(en).length * 0.6);
  });

  it.each(Object.keys(TRANSLATIONS))('%s translates every prose string', (locale) => {
    const untranslated = Object.entries(TRANSLATIONS[locale])
      .filter(([key, value]) => PROSE.test(key) && !PROSE_EXEMPT.has(key) && !CJK.test(value))
      .map(([key]) => key);
    expect(untranslated).toEqual([]);
  });
});
