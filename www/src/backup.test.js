import { describe, expect, it } from 'vitest';
import { EXPORT_FORMAT, readBackup } from './backup';

const valid = (over = {}) => ({
  format: EXPORT_FORMAT,
  categories: [{ id: 'c1', name: 'Groceries', group: 'Food' }],
  transactions: [{ id: 't1', date: '2026-08-27', description: 'NTUC', amount: -20, category_id: 'c1' }],
  rules: [],
  goals: [],
  debts: [],
  budget_plan: { month: '2026-08', entries: [{ id: 'p1', month: '2026-08', category_id: 'c1', planned: 400 }] },
  ...over,
});

describe('readBackup', () => {
  it('accepts a file this app wrote', () => {
    const result = readBackup(valid());
    expect(result.ok).toBe(true);
    expect(result.collections.categories).toHaveLength(1);
    expect(result.count).toBe(3);
  });

  it('tolerates an older file that still carries its own income field', () => {
    // Income used to be exported as its own figure; a file from that era
    // should still restore everything else rather than being rejected.
    const result = readBackup(valid({ income: { month: '2026-08', amount: 3000 } }));
    expect(result.ok).toBe(true);
    expect(result.collections.categories).toHaveLength(1);
  });

  it('rejects anything without our format marker', () => {
    // The import replaces existing data, so a file we only half-recognize
    // must be refused outright rather than partially applied -- the
    // person's only copy may be the thing the import is about to delete.
    expect(readBackup({ ...valid(), format: undefined }).ok).toBe(false);
    expect(readBackup({ ...valid(), format: 'something.else' }).ok).toBe(false);
    expect(readBackup(null).ok).toBe(false);
    expect(readBackup('nope').ok).toBe(false);
  });

  it('names an i18n key rather than prose when it refuses', () => {
    expect(readBackup(null).reason).toBe('err.badImportFile');
  });

  it('rejects a collection that is present but malformed', () => {
    expect(readBackup(valid({ categories: 'not an array' })).ok).toBe(false);
    expect(readBackup(valid({ categories: [{ name: 'no id' }] })).ok).toBe(false);
    expect(readBackup(valid({ budget_plan: { month: '2026-08', entries: [{}] } })).ok).toBe(false);
  });

  it('tolerates a collection that is simply absent', () => {
    // A file written before a feature existed should still restore the
    // parts it does carry.
    const { goals, ...withoutGoals } = valid();
    const result = readBackup(withoutGoals);
    expect(result.ok).toBe(true);
    expect(result.collections.goals).toEqual([]);
  });

});
