import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import en from './en';
import zhHans from './zh-Hans';
import zhHant from './zh-Hant';

// `budget-calc::presets` hands the frontend i18n keys rather than names,
// so a preset whose key has no catalog entry renders as the raw key --
// "cat.groceries" sitting in someone's budget. Nothing else catches that:
// the Rust tests only check the keys are namespaced, and the catalog
// tests only check the three catalogs agree with *each other*, which they
// still would if all three were missing the same key.
//
// Reads the Rust source directly, the same way untranslated-strings.test.js
// reads the components, so adding a preset without translating it fails
// here rather than in someone's browser.

const PRESETS_RS = path.join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'crates',
  'budget-calc',
  'src',
  'presets.rs',
);

function presetKeys() {
  const source = fs.readFileSync(PRESETS_RS, 'utf8');
  // Only the real declarations: the file's own `#[cfg(test)]` block
  // contains prefix literals like "cat.group." that are assertions, not
  // keys, and would otherwise be demanded of every catalog.
  const declarations = source.split('#[cfg(test)]')[0];
  // Both `preset("cat.groceries", ...)` entries and the group constants
  // `("cat.group.food", "Food")` — every string literal starting `cat.`.
  return [...new Set([...declarations.matchAll(/"(cat\.[A-Za-z.]+)"/g)].map((m) => m[1]))];
}

describe('category presets', () => {
  it('finds the keys in the Rust source', () => {
    // Guards the regex itself: a refactor that changed how presets are
    // declared would otherwise make this whole file silently vacuous.
    const keys = presetKeys();
    expect(keys.length).toBeGreaterThan(15);
    expect(keys).toContain('cat.groceries');
    expect(keys).toContain('cat.group.food');
  });

  it.each([
    ['en', en],
    ['zh-Hans', zhHans],
    ['zh-Hant', zhHant],
  ])('%s translates every preset key', (_locale, catalog) => {
    const missing = presetKeys().filter((key) => !(key in catalog));
    expect(missing).toEqual([]);
  });

  it('has no catalog entry for a preset that no longer exists', () => {
    const keys = new Set(presetKeys());
    const orphaned = Object.keys(en).filter((k) => k.startsWith('cat.') && !keys.has(k));
    expect(orphaned).toEqual([]);
  });
});
