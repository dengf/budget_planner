import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import en from './i18n/en';

// English that never reaches `t()` renders untranslated in the middle of an
// otherwise fully translated page. Three shipped that way and were found by
// eye rather than by test: "20.0% of price" under the deposit field, "Custom
// scenario" as a row name, and "Scenario label" as a placeholder.
//
// The catalog tests next door check that the catalogs agree with each other.
// Nothing checked for text that never enters a catalog at all.

const COMPONENTS = path.join(import.meta.dirname, 'components');

function sources() {
  return fs
    .readdirSync(COMPONENTS)
    .filter((f) => f.endsWith('.jsx') && !f.endsWith('.test.jsx'))
    .map((file) => ({
      file,
      // Comments are prose by design and must not be flagged.
      source: fs
        .readFileSync(path.join(COMPONENTS, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, ''),
    }));
}

/**
 * A run of letters containing a lowercase one -- a word rather than a code.
 *
 * Unit symbols are the same in every locale we ship: a suffix of `S$` or
 * `%` is not a translation failure. `months` and `%/yr` are words and are
 * not.
 */
const CARRIES_A_WORD = /[A-Za-z]*[a-z][A-Za-z]/;

/**
 * A catalog key passed as a prop, e.g. `label="refi.newRate"`.
 *
 * A component that renders one shape of input in several places -- the rate
 * fields, which appear on Payment, Amortization, Refinance and Compare --
 * has to be told which heading to give it, and the honest way to pass that
 * is the key, not the English. Checked against the catalog rather than by
 * shape, so a key that does not exist is still a finding.
 */
const isCatalogKey = (text) => Object.hasOwn(en, text);

/**
 * The brand name, which is a proper noun and identical in every locale.
 *
 * Same category as `S$` above: the byline around it does
 * change -- "a meifio app" against "meifio 出品" -- and that sentence *is* in
 * the catalogs, as `app.byline`. Only the name itself is fixed. Matched
 * exactly, so "meifio app" would still be a finding.
 */
const BRAND = new Set(['meifio']);
const isBrand = (text) => BRAND.has(text);

/**
 * User-visible English that is not coming from a catalog.
 *
 * Only patterns that are unambiguous from a single line. A string literal
 * used as a JSX child -- `{n ? \`${n} months\` : 'Never'}` -- is not
 * detected, because telling it apart from a className or a wire value needs
 * a parser, and a guard with false positives gets disabled. The template
 * half of that example is caught; the `'Never'` half is not.
 */
function hardcodedEnglish(source) {
  const found = [];
  const add = (index, text) => {
    if (CARRIES_A_WORD.test(text) && !isCatalogKey(text) && !isBrand(text)) {
      found.push({ line: index + 1, text });
    }
  };

  source.split('\n').forEach((line, index) => {
    // Text sitting directly between JSX tags, e.g. `<span>Loan amount</span>`.
    for (const m of line.matchAll(/>\s*([A-Za-z][A-Za-z ,.'%-]{4,})\s*</g)) {
      add(index, m[1].trim());
    }
    // Props whose value the user reads. `suffix` is one of them: it renders
    // beside the input, and carried a literal "months" for the refinance
    // term and "%/yr" for the property-tax rate.
    for (const m of line.matchAll(
      /\b(?:label|placeholder|title|aria-label|suffix|alt)\s*=\s*['"]([^'"]+)['"]/g,
    )) {
      add(index, m[1]);
    }
    // A template literal splicing a value into English words.
    for (const m of line.matchAll(/`[^`]*\$\{[^}]+\}\s*([A-Za-z][A-Za-z ]+)`/g)) {
      add(index, m[1].trim());
    }
  });
  return found;
}

describe('components put no English on screen that a catalog cannot translate', () => {
  it('finds sources to check', () => {
    expect(sources().length).toBeGreaterThan(10);
  });

  it.each(sources())('$file', ({ file, source }) => {
    expect({ file, hardcoded: hardcodedEnglish(source) }).toEqual({ file, hardcoded: [] });
  });
});
