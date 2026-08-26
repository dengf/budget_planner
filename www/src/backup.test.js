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
  income: { month: '2026-08', amount: 3000 },
  ...over,
});

describe('readBackup', () => {
  it('accepts a file this app wrote', () => {
    const result = readBackup(valid());
    expect(result.ok).toBe(true);
    expect(result.collections.categories).toHaveLength(1);
    expect(result.income).toEqual({ month: '2026-08', amount: 3000 });
    expect(result.count).toBe(3);
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

  it('reports no income rather than zero when the file has none', () => {
    // Zero is a real income figure someone might have saved; absent is
    // not the same thing and must not overwrite what is already there.
    const { income, ...withoutIncome } = valid();
    expect(readBackup(withoutIncome).income).toBeNull();
    expect(readBackup(valid({ income: { month: '2026-08', amount: 0 } })).income).toEqual({
      month: '2026-08',
      amount: 0,
    });
  });
});
