# Budget Flow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the Budget tab into two computed modes — "assign" (still deciding where income goes) and "tracking" (fully assigned, logging spending day to day) — replacing the text-only assign banner with a filling progress ring, replacing the all-or-nothing "Add common categories" button with tap-to-add chips, and giving spend-logging a thumb-reachable bottom entry point once setup is done.

**Architecture:** `BudgetTab.jsx` derives which mode to render from numbers `budget-calc` already computes (`summarize_month`'s `unassigned`) — a pure, host-layer classification, not a new calculation. Five small new files carry the pieces that are independently testable without mounting the whole tab: a pure mode function, a pure preset-filtering function, and three presentational components. `BudgetTab.jsx` itself only wires them together.

**Tech Stack:** React/JSX, Vitest, `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-09-05-budget-tab-redesign-design.md` (Part 2: Create/use flow)

**Depends on:** `docs/superpowers/plans/2026-09-05-budget-categories-update.md` — not a hard technical dependency (nothing here requires the 16-category list to compile or run), but the chip picker in Task 4/6 is more useful with more presets to offer, and this plan's manual mobile check in Task 8 is more representative with the real category set. Land that plan first if doing both.

## Global Constraints

- **`unassigned` and every other budget figure stay Rust's numbers.** This plan adds no new calculation to `budget-calc` — `build_month`, `summarize_month`, `build_savings_line` are untouched. Any arithmetic added here (a fill fraction for the ring, a sort order for a picker) is *display* derivation of numbers Rust already produced, the same category as the existing `(line.spent / line.planned) * 100` progress-bar width already in `BudgetTab.jsx`.
- **Deviation from the spec, made explicit here:** the spec's Part 2 says the tracking-mode "planned-amount column... collapse[s] into a `<details>` section." Implementing that literally — wrapping only the planned-input *cell* of each row — would require `.category-row`'s shared CSS grid (used by Budget, and audited per-column at the 720px breakpoint per this repo's CLAUDE.md) to sometimes render 4 grid cells and sometimes 5, which is real risk to a layout this repo has already broken more than once by editing one tab's grid in isolation. This plan instead **de-emphasizes** the planned-input column with a CSS-only visual treatment (dimmed until focused) while keeping every row's grid structure identical in both modes, and reserves the actual `<details>` collapse for the "add/edit categories" block below the table (the hand-typed form, the chip picker, and the "Add common categories" button), which is a plain block-level section with no shared-grid risk. Net effect is the same declutter goal from the spec, at lower structural risk.
- **The existing "Add common categories" button is not removed**, just moved to sit alongside the hand-typed form as a secondary, all-at-once option — the new chip picker becomes the *primary* way to add a starter category, one at a time, but nothing that already works today is deleted.
- New components follow this repo's existing test-harness convention for anything using `useI18n()`: wrap with `<I18nProvider initialLocale="en">` (see `MonthYearPicker.test.jsx`).
- Any new animation (the ring's fill transition, the FAB's picker open/close) must respect `prefers-reduced-motion: reduce`, per this repo's top-level CLAUDE.md — follow the existing pattern already in `www/src/styles/main.css` (three `@media (prefers-reduced-motion: reduce)` blocks already exist there).
- Mobile-first: the FAB is bottom-anchored and thumb-reachable, all new tap targets are at least 44×44px, nothing depends on hover.

---

### Task 1: `budgetMode` — pure assign/tracking derivation

**Files:**
- Create: `www/src/budgetMode.js`
- Test: `www/src/budgetMode.test.js`

**Interfaces:**
- Produces: `ASSIGN`, `TRACKING` string constants; `budgetMode({ isPastMonth, hasIncome, unassigned }) => ASSIGN | TRACKING`. Task 6 imports all three.

- [ ] **Step 1: Write the failing test**

Create `www/src/budgetMode.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { ASSIGN, TRACKING, budgetMode } from './budgetMode';

describe('budgetMode', () => {
  it('is assign mode before any income exists', () => {
    expect(budgetMode({ isPastMonth: false, hasIncome: false, unassigned: 0 })).toBe(ASSIGN);
  });

  it('is assign mode while income is still unassigned', () => {
    expect(budgetMode({ isPastMonth: false, hasIncome: true, unassigned: 300 })).toBe(ASSIGN);
  });

  it('is assign mode when over-assigned -- there is still a decision to make', () => {
    expect(budgetMode({ isPastMonth: false, hasIncome: true, unassigned: -50 })).toBe(ASSIGN);
  });

  it('is tracking mode once fully assigned', () => {
    expect(budgetMode({ isPastMonth: false, hasIncome: true, unassigned: 0 })).toBe(TRACKING);
  });

  it('is always tracking mode for a past month, even if never fully assigned', () => {
    expect(budgetMode({ isPastMonth: true, hasIncome: true, unassigned: 300 })).toBe(TRACKING);
  });

  it('is tracking mode for a past month even with no income at all', () => {
    expect(budgetMode({ isPastMonth: true, hasIncome: false, unassigned: 0 })).toBe(TRACKING);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd www && npx vitest run src/budgetMode.test.js`
Expected: FAIL — `Cannot find module './budgetMode'`.

- [ ] **Step 3: Write the implementation**

Create `www/src/budgetMode.js`:

```js
// Which "mode" the Budget tab renders in for a given month -- a pure
// classification of numbers budget_calc already computed
// (summarize_month's `unassigned`), never a new calculation. See the
// design spec's Part 2: the same page should feel different while
// there's still an assignment decision to make versus once a month is
// fully planned and day-to-day tracking is what's left.
export const ASSIGN = 'assign';
export const TRACKING = 'tracking';

/**
 * `isPastMonth`: true once the viewed month has ended -- a past month's
 * assignment decision is moot, so it always renders as tracking
 * regardless of whether it ever reached fully-assigned.
 * `hasIncome`: whether any income category has a planned amount yet.
 * `unassigned`: `summary.unassigned` -- income minus total planned. Both
 * positive (still to assign) and negative (over-assigned) count as "not
 * done yet," since an over-assigned month still has a decision to make,
 * just the opposite one.
 */
export function budgetMode({ isPastMonth, hasIncome, unassigned }) {
  if (isPastMonth) return TRACKING;
  if (!hasIncome || unassigned !== 0) return ASSIGN;
  return TRACKING;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd www && npx vitest run src/budgetMode.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add www/src/budgetMode.js www/src/budgetMode.test.js
git commit -m "$(cat <<'EOF'
Add pure assign/tracking mode derivation for the Budget tab

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NbYus8gFyNhzJ11JRwedQE
EOF
)"
```

---

### Task 2: `availablePresets` — shared dedup, plus a single-preset add in `App.jsx`

**Files:**
- Create: `www/src/presetCategories.js`
- Test: `www/src/presetCategories.test.js`
- Modify: `www/src/App.jsx`

**Interfaces:**
- Produces: `availablePresets(presets, existingCategories, translate) => filteredPresets`. Task 6 imports this.
- Produces: a new `addPresetCategory(preset)` async callback in `App.jsx`, passed to `BudgetTab` as a new prop. Task 6 consumes this prop.

- [ ] **Step 1: Write the failing test**

Create `www/src/presetCategories.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { availablePresets } from './presetCategories';

const HOUSING = { key: 'cat.housing' };
const UTILITIES = { key: 'cat.utilities' };
const NAMES = { 'cat.housing': 'Housing', 'cat.utilities': 'Utilities' };
const translate = (key) => NAMES[key];

describe('availablePresets', () => {
  it('offers every preset when nothing exists yet', () => {
    expect(availablePresets([HOUSING, UTILITIES], [], translate)).toEqual([HOUSING, UTILITIES]);
  });

  it('excludes a preset whose translated name is already a category, case- and whitespace-insensitive', () => {
    const existing = [{ id: 'c1', name: ' housing ' }];
    expect(availablePresets([HOUSING, UTILITIES], existing, translate)).toEqual([UTILITIES]);
  });

  it('excludes a preset taken by a hand-typed category with the exact same name', () => {
    const existing = [{ id: 'c1', name: 'Housing' }];
    expect(availablePresets([HOUSING, UTILITIES], existing, translate)).toEqual([UTILITIES]);
  });

  it('returns an empty list once every preset is taken', () => {
    const existing = [{ id: 'c1', name: 'Housing' }, { id: 'c2', name: 'Utilities' }];
    expect(availablePresets([HOUSING, UTILITIES], existing, translate)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd www && npx vitest run src/presetCategories.test.js`
Expected: FAIL — `Cannot find module './presetCategories'`.

- [ ] **Step 3: Write the implementation**

Create `www/src/presetCategories.js`:

```js
// Which starter presets are still worth offering, given the categories a
// budget already has. Shared by App.jsx's "Add common categories" (offers
// every not-yet-taken preset at once) and the Budget tab's chip picker
// (offers them one at a time) -- both need the identical dedup rule, so
// there is one implementation rather than two that could quietly drift.
//
// Matches on the *translated* display name, not the preset key: a
// hand-typed category called "Housing" should still count as taking that
// slot, the same way this dedup already worked before this file existed.
export function availablePresets(presets, existingCategories, translate) {
  const taken = new Set(existingCategories.map((c) => c.name.trim().toLowerCase()));
  return presets.filter((preset) => !taken.has(translate(preset.key).trim().toLowerCase()));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd www && npx vitest run src/presetCategories.test.js`
Expected: PASS.

- [ ] **Step 5: Refactor `App.jsx` to use it, and add `addPresetCategory`**

In `www/src/App.jsx`, add the import near the top (alongside the other local imports):

```js
import { availablePresets } from './presetCategories';
```

Replace the body of the existing `addCommonCategories` (the `for` loop with its manual `taken` set and `continue`):

```js
  const addCommonCategories = useCallback(
    async (existingItems = categories.items) => {
      if (!wasmModule?.preset_categories) return;
      const presets = (await wasmModule.preset_categories()) ?? [];
      for (const preset of availablePresets(presets, existingItems, t)) {
        // Sequential rather than Promise.all: each save is one IndexedDB
        // write through the same store handle, and the list they land in
        // reads better in the order the presets are declared.
        // eslint-disable-next-line no-await-in-loop
        await categories.save({
          id: newId(),
          name: t(preset.key),
          group: t(preset.group_key),
          is_income: preset.is_income,
          description: t(preset.description_key),
          preset_key: preset.key,
        });
      }
    },
    [wasmModule, categories, newId, t],
  );
```

Immediately after it, add the new single-preset variant the chip picker will call:

```js
  /**
   * Adds exactly one starter preset -- the Budget tab's chip picker calls
   * this once per tap, unlike `addCommonCategories` above which seeds
   * every not-yet-taken preset in one shot. Same save shape, just one
   * category instead of a loop over all of them.
   */
  const addPresetCategory = useCallback(
    async (preset) => {
      await categories.save({
        id: newId(),
        name: t(preset.key),
        group: t(preset.group_key),
        is_income: preset.is_income,
        description: t(preset.description_key),
        preset_key: preset.key,
      });
    },
    [categories, newId, t],
  );
```

Find where `addCommonCategories` is returned/exposed further down `App.jsx` (search for the existing line `addCommonCategories,` inside the object `App.jsx` builds for its own use / returns) and add `addPresetCategory,` next to it, and in the `<ActivePanel ... />` JSX block (search for `addCommonCategories={addCommonCategories}`), add the sibling prop:

```jsx
              addCommonCategories={addCommonCategories}
              addPresetCategory={addPresetCategory}
```

- [ ] **Step 6: Run the full frontend suite**

Run: `cd www && npm test`
Expected: PASS. `App.jsx` has no dedicated test file today, so this refactor's safety net is (a) `presetCategories.test.js` above covering the extracted logic, and (b) this full-suite run confirming nothing else broke.

- [ ] **Step 7: Manual smoke check**

Run: `cd www && npm start`, open the app, use "My data" → "Clear all data" to reach a fresh empty budget, and confirm it re-seeds with all 16 starter categories exactly as before (this exercises `addCommonCategories` end to end, which has no automated test).

- [ ] **Step 8: Commit**

```bash
git add www/src/presetCategories.js www/src/presetCategories.test.js www/src/App.jsx
git commit -m "$(cat <<'EOF'
Extract shared preset-dedup helper, add single-preset add

addCommonCategories and the upcoming chip picker need the identical
"is this preset already taken" rule -- one implementation instead of
two that could drift.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NbYus8gFyNhzJ11JRwedQE
EOF
)"
```

---

### Task 3: `AssignProgressRing` — the filling ring

**Files:**
- Create: `www/src/components/AssignProgressRing.jsx`
- Test: `www/src/components/AssignProgressRing.test.jsx`

**Interfaces:**
- Produces: `<AssignProgressRing fraction={number} state={'start'|'onTrack'|'over'} />`. Task 6 renders this inside the assign banner.

- [ ] **Step 1: Write the failing test**

Create `www/src/components/AssignProgressRing.test.jsx`:

```jsx
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AssignProgressRing from './AssignProgressRing';

const CIRCUMFERENCE = 2 * Math.PI * 24;

describe('AssignProgressRing', () => {
  it('applies the state as a modifier class', () => {
    const { container } = render(<AssignProgressRing fraction={0.5} state="over" />);
    expect(container.querySelector('svg').classList).toContain('assign-progress-ring-over');
  });

  it('clamps a fraction above 1 so the ring never draws past full', () => {
    const { container } = render(<AssignProgressRing fraction={1.5} state="over" />);
    const fill = container.querySelector('.ring-fill');
    expect(Number(fill.getAttribute('stroke-dashoffset'))).toBeCloseTo(0, 5);
  });

  it('clamps a negative fraction to a fully empty ring', () => {
    const { container } = render(<AssignProgressRing fraction={-0.3} state="start" />);
    const fill = container.querySelector('.ring-fill');
    expect(Number(fill.getAttribute('stroke-dashoffset'))).toBeCloseTo(CIRCUMFERENCE, 5);
  });

  it('is decorative -- the adjacent assign-label text carries the meaning', () => {
    const { container } = render(<AssignProgressRing fraction={0.5} state="onTrack" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd www && npx vitest run src/components/AssignProgressRing.test.jsx`
Expected: FAIL — `Cannot find module './AssignProgressRing'`.

- [ ] **Step 3: Write the implementation**

Create `www/src/components/AssignProgressRing.jsx`:

```jsx
import React from 'react';

const RADIUS = 24;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The zero-based-budgeting "win state," made visual: a ring that fills as
 * `total_planned` approaches `income`. Text alone (the assign banner)
 * already said this; research on budgeting-app gamification consistently
 * points at a visibly filling indicator as what turns "assign every
 * dollar" into something that feels like progress rather than a chore.
 * Pure presentational -- `fraction` and `state` are derived by the
 * caller from budget_calc's own numbers, nothing new is calculated here.
 *
 * `aria-hidden` -- same convention as `CategoryBadge`: the adjacent
 * `.assign-label` text already carries the accessible meaning.
 */
export default function AssignProgressRing({ fraction, state }) {
  const clamped = Math.max(0, Math.min(1, fraction));
  const offset = CIRCUMFERENCE * (1 - clamped);
  return (
    <svg
      className={`assign-progress-ring assign-progress-ring-${state}`}
      viewBox="0 0 56 56"
      aria-hidden="true"
    >
      <circle className="ring-track" cx="28" cy="28" r={RADIUS} />
      <circle
        className="ring-fill"
        cx="28"
        cy="28"
        r={RADIUS}
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={offset}
        transform="rotate(-90 28 28)"
      />
    </svg>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd www && npx vitest run src/components/AssignProgressRing.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add www/src/components/AssignProgressRing.jsx www/src/components/AssignProgressRing.test.jsx
git commit -m "$(cat <<'EOF'
Add AssignProgressRing, a visual fill indicator for zero-based assignment

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NbYus8gFyNhzJ11JRwedQE
EOF
)"
```

---

### Task 4: `CategoryChipPicker` — tap-to-add starter categories

**Files:**
- Create: `www/src/components/CategoryChipPicker.jsx`
- Test: `www/src/components/CategoryChipPicker.test.jsx`

**Interfaces:**
- Consumes: `CategoryBadge` (existing, `www/src/components/CategoryBadge.jsx`), `useI18n` (existing, `www/src/i18n`).
- Produces: `<CategoryChipPicker presets={presetArray} onAdd={(preset) => void} />`. Task 6 passes it the output of `availablePresets` from Task 2.

- [ ] **Step 1: Write the failing test**

Create `www/src/components/CategoryChipPicker.test.jsx`:

```jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import CategoryChipPicker from './CategoryChipPicker';

const HOUSING = {
  key: 'cat.housing',
  group_key: 'cat.group.expense',
  is_income: false,
  description_key: 'cat.housing.desc',
};

function renderPicker(props) {
  return render(
    <I18nProvider initialLocale="en">
      <CategoryChipPicker presets={[HOUSING]} onAdd={() => {}} {...props} />
    </I18nProvider>,
  );
}

describe('CategoryChipPicker', () => {
  it('renders a chip per preset it is given', () => {
    renderPicker();
    expect(screen.getByRole('button', { name: /Housing/i })).toBeInTheDocument();
  });

  it('calls onAdd with exactly the tapped preset', () => {
    const onAdd = vi.fn();
    renderPicker({ onAdd });
    fireEvent.click(screen.getByRole('button', { name: /Housing/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith(HOUSING);
  });

  it('renders nothing when it is given no presets', () => {
    const { container } = render(
      <I18nProvider initialLocale="en">
        <CategoryChipPicker presets={[]} onAdd={() => {}} />
      </I18nProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd www && npx vitest run src/components/CategoryChipPicker.test.jsx`
Expected: FAIL — `Cannot find module './CategoryChipPicker'`.

- [ ] **Step 3: Write the implementation**

Create `www/src/components/CategoryChipPicker.jsx`:

```jsx
import React from 'react';
import { useI18n } from '../i18n';
import CategoryBadge from './CategoryBadge';

/**
 * One tap, one category -- offered as a row of chips rather than
 * `addCommonCategories`'s all-16-at-once button, so a first-time budget
 * can start with the three or four presets someone actually recognizes
 * instead of every starter category landing on the page unasked (the
 * Goodbudget-sourced finding in the design spec: don't front-load more
 * decisions than necessary).
 *
 * `presets` is expected to already be filtered to "not yet added" -- see
 * `availablePresets` in `presetCategories.js`. This component only
 * renders whatever list it's handed and reports which one was tapped;
 * it doesn't know or care what's already been added.
 */
export default function CategoryChipPicker({ presets, onAdd }) {
  const { t } = useI18n();
  if (presets.length === 0) return null;
  return (
    <div className="category-chip-picker">
      {presets.map((preset) => (
        <button
          key={preset.key}
          type="button"
          className="category-chip"
          onClick={() => onAdd(preset)}
        >
          <CategoryBadge category={{ preset_key: preset.key, is_income: preset.is_income }} />
          {t(preset.key)}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd www && npx vitest run src/components/CategoryChipPicker.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add www/src/components/CategoryChipPicker.jsx www/src/components/CategoryChipPicker.test.jsx
git commit -m "$(cat <<'EOF'
Add CategoryChipPicker, tap-to-add starter categories one at a time

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NbYus8gFyNhzJ11JRwedQE
EOF
)"
```

---

### Task 5: `QuickAddFab` — the bottom-anchored quick-add entry point

**Files:**
- Create: `www/src/components/QuickAddFab.jsx`
- Test: `www/src/components/QuickAddFab.test.jsx`

**Interfaces:**
- Consumes: `CategoryBadge`, `useI18n`.
- Produces: `<QuickAddFab categories={[{id, name, is_income, preset_key}]} onPick={(categoryId) => void} />`. Task 7 wires `onPick` to the existing `openSpend` plus a new scroll-to-row helper.

- [ ] **Step 1: Write the failing test**

Create `www/src/components/QuickAddFab.test.jsx`:

```jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import QuickAddFab from './QuickAddFab';

const CATEGORIES = [
  { id: 'c2', name: 'Utilities', is_income: false },
  { id: 'c1', name: 'Groceries', is_income: false },
];

function renderFab(props) {
  return render(
    <I18nProvider initialLocale="en">
      <QuickAddFab categories={CATEGORIES} onPick={() => {}} {...props} />
    </I18nProvider>,
  );
}

describe('QuickAddFab', () => {
  it('renders nothing when there are no categories to log against', () => {
    const { container } = render(
      <I18nProvider initialLocale="en">
        <QuickAddFab categories={[]} onPick={() => {}} />
      </I18nProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('opens the category picker when tapped', () => {
    renderFab();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /log spending or income/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('lists categories alphabetically regardless of the order it was given', () => {
    renderFab();
    fireEvent.click(screen.getByRole('button', { name: /log spending or income/i }));
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent);
    expect(items).toEqual(['Groceries', 'Utilities']);
  });

  it('calls onPick with the tapped category id and closes the picker', () => {
    const onPick = vi.fn();
    renderFab({ onPick });
    fireEvent.click(screen.getByRole('button', { name: /log spending or income/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Groceries/i }));
    expect(onPick).toHaveBeenCalledWith('c1');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd www && npx vitest run src/components/QuickAddFab.test.jsx`
Expected: FAIL — `Cannot find module './QuickAddFab'`.

The test also looks up the FAB's button by its accessible name, `/log spending or income/i`, which comes from a new i18n key this component needs. Add it now (Task 7 needs a different new key, `budget.editCategoriesTitle` — this one is unrelated and belongs here, with the component that uses it):

In `www/src/i18n/en.js`, add near `'budget.logIncome': 'Log income',`:

```js
  'budget.logTransaction': 'Log spending or income',
```

In `www/src/i18n/zh-Hans.js`, add near the equivalent line:

```js
  'budget.logTransaction': '记一笔支出或收入',
```

In `www/src/i18n/zh-Hant.js`, add near the equivalent line:

```js
  'budget.logTransaction': '記一筆支出或收入',
```

- [ ] **Step 3: Write the implementation**

Create `www/src/components/QuickAddFab.jsx`:

```jsx
import React, { useState } from 'react';
import { useI18n } from '../i18n';
import CategoryBadge from './CategoryBadge';

/**
 * The bottom-anchored, thumb-reachable way to log a transaction once a
 * month is fully assigned -- this repo's mobile-first rule says the
 * action someone reaches for most belongs where a thumb can hit it
 * without a grip shift, and relying on a small per-row "+" as the only
 * entry point doesn't satisfy that.
 *
 * Doesn't duplicate the existing per-row quick-add form: picking a
 * category here just reports which id was picked, and the caller
 * (`BudgetTab`) opens that row's existing inline form and scrolls to it,
 * the same `openSpend` state machine the per-row "+" already drives.
 */
export default function QuickAddFab({ categories, onPick }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);

  if (categories.length === 0) return null;

  const sorted = [...categories].sort((a, b) => a.name.localeCompare(b.name, locale));

  return (
    <>
      {open && (
        <div className="fab-picker" role="menu">
          {sorted.map((category) => (
            <button
              key={category.id}
              type="button"
              role="menuitem"
              className="fab-picker-item"
              onClick={() => {
                setOpen(false);
                onPick(category.id);
              }}
            >
              <CategoryBadge category={category} />
              {category.name}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="fab-add"
        aria-expanded={open}
        aria-label={t('budget.logTransaction')}
        onClick={() => setOpen((o) => !o)}
      >
        +
      </button>
    </>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd www && npx vitest run src/components/QuickAddFab.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add www/src/components/QuickAddFab.jsx www/src/components/QuickAddFab.test.jsx www/src/i18n/en.js www/src/i18n/zh-Hans.js www/src/i18n/zh-Hant.js
git commit -m "$(cat <<'EOF'
Add QuickAddFab, a thumb-reachable bottom entry point for logging spend

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NbYus8gFyNhzJ11JRwedQE
EOF
)"
```

---

### Task 6: Wire assign mode into `BudgetTab.jsx` — ring and chip picker

**Files:**
- Modify: `www/src/components/BudgetTab.jsx`

**Interfaces:**
- Consumes: `budgetMode`/`ASSIGN`/`TRACKING` (Task 1), `availablePresets` (Task 2), `addPresetCategory` prop (Task 2), `AssignProgressRing` (Task 3), `CategoryChipPicker` (Task 4).

This task has no isolated unit test of its own — `BudgetTab.jsx` has no existing test file, and adding a full render-harness for it (mocking `wasmModule`'s half-dozen async methods) is out of scope for this redesign. Correctness here rests on the already-tested pieces being wired with the right props, plus the manual verification at the end of this task and the fuller manual pass in Task 8.

- [ ] **Step 1: Add the new imports**

At the top of `www/src/components/BudgetTab.jsx`, alongside the existing local imports:

```js
import { ASSIGN, budgetMode } from '../budgetMode';
import { availablePresets } from '../presetCategories';
import AssignProgressRing from './AssignProgressRing';
import CategoryChipPicker from './CategoryChipPicker';
```

- [ ] **Step 2: Accept the new `addPresetCategory` prop**

Find the component's prop destructuring:

```js
export default function BudgetTab({
  wasmModule,
  currencySymbol,
  today,
  viewMonth,
  setViewMonth,
  categories,
  removeCategory,
  addCommonCategories,
  transactions,
  budgetPlan,
  goals,
  debts,
  recurring,
}) {
```

Add `addPresetCategory` to the list:

```js
export default function BudgetTab({
  wasmModule,
  currencySymbol,
  today,
  viewMonth,
  setViewMonth,
  categories,
  removeCategory,
  addCommonCategories,
  addPresetCategory,
  transactions,
  budgetPlan,
  goals,
  debts,
  recurring,
}) {
```

- [ ] **Step 3: Load the preset list**

Find the component's existing state declarations (`const [result, setResult] = useState(null);` and its neighbors) and add one more:

```js
  const [presetCategories, setPresetCategories] = useState([]);
```

Find the existing `upcoming` effect (the one calling `wasmModule.recurring_occurrences`) and add a sibling effect right after it, loading the presets once:

```js
  /** The full starter-preset list, for the chip picker -- loaded once
   *  `wasmModule` is ready. Unlike `addCommonCategories`'s own call to
   *  the same binding, this one is kept in state so the picker can
   *  re-filter it against `categories.items` on every render without
   *  re-fetching from wasm each time. */
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!wasmModule?.preset_categories) return;
      const presets = (await wasmModule.preset_categories()) ?? [];
      if (!cancelled) setPresetCategories(presets);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [wasmModule]);
```

- [ ] **Step 4: Compute the mode**

Find:

```js
  const hasIncome = (summary?.income ?? 0) > 0;
  const hasBudget = hasIncome && (summary?.total_planned ?? 0) > 0;
```

Add right after it:

```js
  const mode = budgetMode({ isPastMonth, hasIncome, unassigned });
```

- [ ] **Step 5: Put the ring in the assign banner**

Find the assign banner block:

```jsx
          <div
            className={`assign-banner${hasBudget ? '' : ' assign-banner-start'}${unassigned < 0 ? ' assign-banner-over' : ''}`}
          >
            <span className="assign-label">
              {!hasIncome
                ? t('budget.startWithIncome')
                : !hasBudget
                  ? t('budget.assignPrompt', { amount: formatMoney(summary.income) })
                  : unassigned === 0
                    ? t('budget.fullyAssigned')
                    : unassigned > 0
                      ? t('budget.unassignedPositive', { amount: formatMoney(unassigned) })
                      : t('budget.unassignedNegative', { amount: formatMoney(-unassigned) })}
            </span>
            {hasIncome && <span className="assign-value">{formatMoney(unassigned)}</span>}
          </div>
```

Replace it with:

```jsx
          <div
            className={`assign-banner${hasBudget ? '' : ' assign-banner-start'}${unassigned < 0 ? ' assign-banner-over' : ''}`}
          >
            <AssignProgressRing
              fraction={summary.income > 0 ? summary.total_planned / summary.income : 0}
              state={!hasIncome ? 'start' : unassigned < 0 ? 'over' : 'onTrack'}
            />
            <div className="assign-banner-text">
              <span className="assign-label">
                {!hasIncome
                  ? t('budget.startWithIncome')
                  : !hasBudget
                    ? t('budget.assignPrompt', { amount: formatMoney(summary.income) })
                    : unassigned === 0
                      ? t('budget.fullyAssigned')
                      : unassigned > 0
                        ? t('budget.unassignedPositive', { amount: formatMoney(unassigned) })
                        : t('budget.unassignedNegative', { amount: formatMoney(-unassigned) })}
              </span>
              {hasIncome && <span className="assign-value">{formatMoney(unassigned)}</span>}
            </div>
          </div>
```

- [ ] **Step 6: Add the chip picker above the hand-typed form**

Find:

```jsx
      <form className="form-grid" onSubmit={addCategory}>
```

Insert immediately before it:

```jsx
      {mode === ASSIGN && (
        <CategoryChipPicker
          presets={availablePresets(presetCategories, categories.items, t)}
          onAdd={addPresetCategory}
        />
      )}

      <form className="form-grid" onSubmit={addCategory}>
```

- [ ] **Step 7: Run the frontend suite**

Run: `cd www && npm test`
Expected: PASS (no test in this task, but everything imported must still resolve and every other suite must stay green).

- [ ] **Step 8: Manual check**

Run: `cd www && npm start`, open the Budget tab on a fresh/empty budget. Confirm: the assign banner now shows a ring next to its text; tapping a chip adds exactly that one category (and it disappears from the picker); the banner's ring visibly fills as planned amounts are typed in.

- [ ] **Step 9: Commit**

```bash
git add www/src/components/BudgetTab.jsx
git commit -m "$(cat <<'EOF'
Wire assign-mode progress ring and chip picker into the Budget tab

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NbYus8gFyNhzJ11JRwedQE
EOF
)"
```

---

### Task 7: Wire tracking mode into `BudgetTab.jsx` — declutter and the FAB

**Files:**
- Modify: `www/src/components/BudgetTab.jsx`
- Modify: `www/src/i18n/en.js`, `www/src/i18n/zh-Hans.js`, `www/src/i18n/zh-Hant.js`

**Interfaces:**
- Consumes: `TRACKING` (Task 1), `QuickAddFab` (Task 5).

- [ ] **Step 1: Add the `budget.editCategoriesTitle` key**

In `www/src/i18n/en.js`, add near `'budget.commonHint':`:

```js
  'budget.editCategoriesTitle': 'Add or edit categories',
```

In `www/src/i18n/zh-Hans.js`, add the equivalent:

```js
  'budget.editCategoriesTitle': '添加或编辑分类',
```

In `www/src/i18n/zh-Hant.js`, add the equivalent:

```js
  'budget.editCategoriesTitle': '新增或編輯分類',
```

Run: `cd www && npx vitest run src/i18n/catalogs.test.js`
Expected: PASS (all three catalogs still carry matching keys).

- [ ] **Step 2: Import `TRACKING` and `QuickAddFab`**

In `www/src/components/BudgetTab.jsx`, change the Task 6 import:

```js
import { ASSIGN, budgetMode } from '../budgetMode';
```

to:

```js
import { ASSIGN, TRACKING, budgetMode } from '../budgetMode';
```

Add, alongside the other new component imports:

```js
import QuickAddFab from './QuickAddFab';
```

- [ ] **Step 3: Add a scroll-to-row helper**

Near `openSpend` (which already exists), add:

```js
  /** Where the FAB's category picker sends focus after a pick -- the
   *  row's own quick-add form (opened by `openSpend` below) is what
   *  actually receives the entry; this only makes sure it's on screen.
   *  Respects `prefers-reduced-motion`, per this repo's CLAUDE.md. */
  const scrollToCategoryRow = (categoryId) => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document
      .getElementById(`category-row-${categoryId}`)
      ?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  };
```

- [ ] **Step 4: Give each category row a stable DOM id**

Find, inside `orderedLines.map((line, i) => { ... })`:

```jsx
                <div className="category-row">
```

Replace with:

```jsx
                <div className="category-row" id={`category-row-${line.category_id}`}>
```

- [ ] **Step 5: Mark the category table with the mode, for CSS de-emphasis**

Find:

```jsx
        <div className="category-table">
```

Replace with:

```jsx
        <div className={`category-table${mode === TRACKING ? ' category-table-tracking' : ''}`}>
```

- [ ] **Step 6: Collapse the add/edit-categories block in tracking mode**

Find the block spanning from the chip picker (added in Task 6) through the "Add common categories" hint:

```jsx
      {mode === ASSIGN && (
        <CategoryChipPicker
          presets={availablePresets(presetCategories, categories.items, t)}
          onAdd={addPresetCategory}
        />
      )}

      <form className="form-grid" onSubmit={addCategory}>
        <label className="field">
          <span className="field-label">{t('budget.categoryName')}</span>
          <div className="field-input">
            <input
              value={newCategory.name}
              onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
            />
          </div>
        </label>
        <label className="field">
          <span className="field-label">{t('budget.categoryGroup')}</span>
          <div className="field-input">
            <input
              value={newCategory.group}
              onChange={(e) => setNewCategory({ ...newCategory, group: e.target.value })}
            />
          </div>
        </label>
        <label className="field field-check">
          <input
            type="checkbox"
            checked={newCategory.isIncome}
            onChange={(e) => setNewCategory({ ...newCategory, isIncome: e.target.checked })}
          />
          <span>{t('budget.categoryIsIncome')}</span>
        </label>
        <button className="btn" type="submit">
          {t('budget.addCategory')}
        </button>
        <button className="btn secondary" type="button" onClick={() => addCommonCategories()}>
          {t('budget.addCommon')}
        </button>
      </form>
      <p className="field-label">{t('budget.commonHint')}</p>
```

Replace it with the same content, split into a variable so it can render either bare (assign mode) or inside a `<details>` (tracking mode) without duplicating the JSX:

```jsx
      {(() => {
        const editCategoriesBlock = (
          <>
            {mode === ASSIGN && (
              <CategoryChipPicker
                presets={availablePresets(presetCategories, categories.items, t)}
                onAdd={addPresetCategory}
              />
            )}
            <form className="form-grid" onSubmit={addCategory}>
              <label className="field">
                <span className="field-label">{t('budget.categoryName')}</span>
                <div className="field-input">
                  <input
                    value={newCategory.name}
                    onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                  />
                </div>
              </label>
              <label className="field">
                <span className="field-label">{t('budget.categoryGroup')}</span>
                <div className="field-input">
                  <input
                    value={newCategory.group}
                    onChange={(e) => setNewCategory({ ...newCategory, group: e.target.value })}
                  />
                </div>
              </label>
              <label className="field field-check">
                <input
                  type="checkbox"
                  checked={newCategory.isIncome}
                  onChange={(e) => setNewCategory({ ...newCategory, isIncome: e.target.checked })}
                />
                <span>{t('budget.categoryIsIncome')}</span>
              </label>
              <button className="btn" type="submit">
                {t('budget.addCategory')}
              </button>
              <button className="btn secondary" type="button" onClick={() => addCommonCategories()}>
                {t('budget.addCommon')}
              </button>
            </form>
            <p className="field-label">{t('budget.commonHint')}</p>
          </>
        );
        return mode === TRACKING ? (
          <details className="collapsible-panel">
            <summary>{t('budget.editCategoriesTitle')}</summary>
            {editCategoriesBlock}
          </details>
        ) : (
          editCategoriesBlock
        );
      })()}
```

- [ ] **Step 7: Render the FAB**

Find the component's closing `</div>` right after `<SpendChart .../>`:

```jsx
      <SpendChart
        lines={orderedLines.filter((l) => !isIncome(l.category_id))}
        categoryName={categoryName}
        formatMoney={formatMoney}
      />
    </div>
  );
}
```

Insert the FAB between `<SpendChart />` and the closing `</div>`:

```jsx
      <SpendChart
        lines={orderedLines.filter((l) => !isIncome(l.category_id))}
        categoryName={categoryName}
        formatMoney={formatMoney}
      />
      {mode === TRACKING && isCurrentMonth && (
        <QuickAddFab
          categories={categories.items}
          onPick={(categoryId) => {
            openSpend(categoryId);
            scrollToCategoryRow(categoryId);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 8: Run the frontend suite**

Run: `cd www && npm test`
Expected: PASS.

- [ ] **Step 9: Manual check**

Run: `cd www && npm start`. On a fully-assigned current-month budget, confirm: the "Add or edit categories" section is now collapsed behind a summary line; tapping it expands to the same chip picker/form as before; a round "+" button sits fixed at the bottom of the screen; tapping it lists every category alphabetically; tapping one scrolls to that category's row and opens its existing inline quick-add form, identical to what the row's own "+" already opens.

- [ ] **Step 10: Commit**

```bash
git add www/src/components/BudgetTab.jsx www/src/i18n/en.js www/src/i18n/zh-Hans.js www/src/i18n/zh-Hant.js
git commit -m "$(cat <<'EOF'
Wire tracking-mode declutter and the bottom quick-add FAB into Budget

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NbYus8gFyNhzJ11JRwedQE
EOF
)"
```

---

### Task 8: CSS, reduced motion, and the mobile pass

**Files:**
- Modify: `www/src/styles/main.css`

- [ ] **Step 1: Restructure `.assign-banner` to hold the ring alongside its text**

Find:

```css
.assign-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px 16px;
  padding: 18px 20px;
  margin-bottom: 12px;
  background: var(--positive-bg);
  border: 1px solid var(--positive-border);
  border-radius: 16px;
  box-shadow: var(--hero-shadow);
}
.assign-label {
  font-size: 1.02rem;
  font-weight: 600;
  color: var(--ink);
}
.assign-value {
  font-size: 1.7rem;
  font-weight: 700;
  color: var(--positive);
  font-variant-numeric: tabular-nums;
}
```

Replace with:

```css
.assign-banner {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 20px;
  margin-bottom: 12px;
  background: var(--positive-bg);
  border: 1px solid var(--positive-border);
  border-radius: 16px;
  box-shadow: var(--hero-shadow);
}
.assign-banner-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px 16px;
}
.assign-label {
  font-size: 1.02rem;
  font-weight: 600;
  color: var(--ink);
}
.assign-value {
  font-size: 1.7rem;
  font-weight: 700;
  color: var(--positive);
  font-variant-numeric: tabular-nums;
}

.assign-progress-ring {
  flex: none;
  width: 48px;
  height: 48px;
}
.assign-progress-ring circle {
  fill: none;
  stroke-width: 6;
}
.assign-progress-ring .ring-track {
  stroke: var(--line);
}
.assign-progress-ring .ring-fill {
  stroke: var(--positive);
  stroke-linecap: round;
  transition: stroke-dashoffset 0.4s ease;
}
.assign-progress-ring-over .ring-fill {
  stroke: var(--negative);
}
.assign-progress-ring-start .ring-fill {
  stroke: var(--muted);
}
```

- [ ] **Step 2: Add tracking-mode de-emphasis for the planned-input column**

Add, right after `.progress-fill.over` (the existing progress-bar-over rule):

```css
/* Deliberately dims rather than removes the planned-input cell in
   tracking mode -- see the plan's "Deviation from the spec" note for
   why: `.category-row`'s grid must stay the same shape in both modes.
   `:focus-within` restores it, so it's always fully usable, just quieter
   once a month's assignment decision is already made. */
.category-table-tracking .planned-input {
  opacity: 0.55;
}
.category-table-tracking .planned-input:focus-within {
  opacity: 1;
}
```

- [ ] **Step 3: Add the chip picker's styling**

```css
.category-chip-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 4px 0 16px;
}
.category-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--panel-alt);
  color: var(--ink);
  font-size: 0.9rem;
}
.category-chip:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

- [ ] **Step 4: Add the FAB and its picker**

```css
.fab-add {
  position: fixed;
  right: 20px;
  bottom: max(20px, env(safe-area-inset-bottom));
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  background: var(--accent);
  color: var(--accent-ink);
  font-size: 1.8rem;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--hero-shadow);
  z-index: 20;
}
.fab-picker {
  position: fixed;
  right: 20px;
  bottom: calc(84px + env(safe-area-inset-bottom));
  width: min(280px, calc(100vw - 40px));
  max-height: 60vh;
  overflow-y: auto;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 8px;
  box-shadow: var(--hero-shadow);
  z-index: 21;
}
.fab-picker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  padding: 8px 10px;
  border-radius: 10px;
  border: none;
  background: transparent;
  color: var(--ink);
  text-align: left;
  font-size: 0.92rem;
}
.fab-picker-item:hover,
.fab-picker-item:focus-visible {
  background: var(--panel-alt);
}
```

- [ ] **Step 5: Respect `prefers-reduced-motion`**

Find any one of the three existing `@media (prefers-reduced-motion: reduce)` blocks in this file and add this rule inside it (or, if adding a new block, place it near the others rather than scattered elsewhere):

```css
  .assign-progress-ring .ring-fill {
    transition: none;
  }
```

- [ ] **Step 6: Run the full test suite one more time**

Run: `cd www && npm test`
Expected: PASS.

- [ ] **Step 7: Manual mobile-width check**

Run: `cd www && npm start`, open the app, and resize (or use device emulation) to 375×812. Verify:
- The assign-banner ring doesn't overflow or force the banner to wrap awkwardly; label text still wraps under the value at this width the way it did before.
- Category chips wrap onto multiple lines cleanly and each chip's tappable area is at least 44px tall.
- The bottom "+" sits clear of the browser's own UI chrome and doesn't overlap the category table's last row when scrolled to the bottom.
- The FAB's picker list doesn't run off the top or sides of the viewport, and scrolls internally if it's taller than available space.
- With the OS/browser's reduce-motion setting on, the ring's fill appears instantly rather than animating, and the FAB's picker open/close has no transition to disable (it already has none — confirm nothing was added in Step 4 above that needs one).

- [ ] **Step 8: Commit**

```bash
git add www/src/styles/main.css
git commit -m "$(cat <<'EOF'
Style the assign ring, chip picker and quick-add FAB; verify at 375px

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NbYus8gFyNhzJ11JRwedQE
EOF
)"
```

---

## Done when

- `cd www && npm test` is green.
- On an empty budget: the assign banner shows a ring; category chips add one category per tap; the hand-typed form and "Add common categories" still work.
- On a fully-assigned current-month budget: the add/edit-categories section is collapsed behind a summary; planned inputs are visually quieter but still editable; a bottom "+" opens a category chooser that scrolls to and opens the right row's existing quick-add form.
- A past month always renders in tracking mode regardless of its `unassigned` value.
- Verified at 375×812 per Task 8, Step 7.
