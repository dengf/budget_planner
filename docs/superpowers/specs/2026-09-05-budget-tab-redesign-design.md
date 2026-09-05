# Budget tab redesign: categories + create/use flow

Date: 2026-09-05
Status: approved for planning

## Why

The Budget tab's starter categories and its single flat-table layout
haven't been revisited since they were first built. Two rounds of
research (see summaries below) turned up concrete, sourced gaps in both:
the category list is missing lines every comparable app treats as
standard, and the page blends first-time setup with month-50 tracking
into one always-fully-visible table, which research on budgeting-app
abandonment ties directly to decision fatigue and a missing "win state"
for the zero-based-budgeting loop this app already computes correctly.

Success criteria, in the user's own words: **intuitive, fun to use,
practical.** Free rein on structure — nothing about today's layout is
sacred.

## Research summary

**Categories** (compared current 14 presets against YNAB, EveryDollar/
Ramsey, Monarch Money, and 50/30/20-style sources):
- Every source gives recurring digital spend (streaming, gym, software)
  its own bucket; this app buries it inside "Personal & Lifestyle."
- EveryDollar and Monarch both make "Gifts & Donations" top-level; this
  app has no home for it except "Other Expenses."
- Three labels read CPA-formal next to how competitors phrase the same
  thing: "Investment & Capital Income," "Debt Servicing," "Government &
  Supplemental."
- Everything else in the current list matches the market closely.
- Open tension: competitors treat savings as an assignable target
  category; this app computes "Savings" as a residual (income minus
  actual expenses). Resolution below.

**Flow** (compared current single-scrolling-table shape against YNAB,
EveryDollar, Goodbudget, Monarch, and budgeting-app-abandonment research):
- None of the comparable apps blend "build the budget" and "log a
  transaction" into one view the way this app does.
- Manual entry, decision fatigue from doing everything at once, and a
  shame-inducing red/green convention are the most-cited reasons people
  abandon budgeting apps.
- A visibly filling progress ring/bar for "dollars assigned" is
  consistently cited as what makes the zero-based-budgeting loop feel
  satisfying rather than like form-filling — this app already computes
  `unassigned` correctly, it just doesn't give it a strong visual.
- Progressive disclosure (reveal depth as it becomes relevant) beats
  front-loaded tours or forced wizard steps.

## Part 1: Category taxonomy

### Changes to `budget-calc/src/presets.rs`

Add two expense presets:

| key | name | description |
|---|---|---|
| `cat.subscriptionsMemberships` | Subscriptions & Memberships | Streaming services, gym and other memberships, software subscriptions, recurring app fees. |
| `cat.giftsDonations` | Gifts & Donations | Birthday and holiday gifts, charitable donations, tithing. |

Update `cat.personalLifestyle`'s description to remove what moved out:
"Clothing/shoes, personal care, hobbies." (drops "gym memberships,
streaming services").

Rename three existing presets' display text only (keys, group, and
`is_income` are untouched — this is copy, not restructuring):

| key | old name | new name |
|---|---|---|
| `cat.investmentCapitalIncome` | Investment & Capital Income | Investments |
| `cat.debtServicing` | Debt Servicing | Debt Payments |
| `cat.governmentSupplemental` | Government & Supplemental | Government Benefits |

Net result: 5 income + 11 expense = 16 starter presets. Existing tests
in `presets.rs` (`five_income_categories_and_nine_expense_categories`,
etc.) get updated counts; no test's *intent* changes.

### No retroactive migration

`Category.name`/`description` are plain strings frozen at the moment
`addCommonCategories` seeds them — `preset_key` (stored separately,
`budget-ports::CategoryRecord`) exists only for icon/color matching, not
as a live pointer back to preset text (see its own doc comment). Renaming
a preset changes what *future* seedings produce; it does not touch a
category someone already saved under the old name. This matches the
existing, deliberate behavior for locale switches and is not a gap this
work needs to close.

### Frontend touch points

- `www/src/i18n/en.js`, `zh-Hans.js`, `zh-Hant.js`: add the two new keys'
  name/description/group entries, update the three renamed entries, and
  trim `cat.personalLifestyle.desc`. `i18n/presets.test.js` and
  `catalogs.test.js` enforce parity across all three catalogs plus the
  `budget-calc` key list — expect them to fail until every catalog is
  updated, which is the intended guardrail.
- `www/src/categoryVisuals.js`: add `cat.subscriptionsMemberships` and
  `cat.giftsDonations` to `PRESET_KEY_ORDER` (fixes their permanent color
  slot) and to `PRESET_ICONS`. Two new icons needed in
  `CategoryIcons.jsx` (e.g. a repeat/refresh glyph for subscriptions, a
  gift-box glyph for donations) drawn in the same hand-built inline-SVG
  style as the existing set; until drawn, both presets fall back to
  `expense-generic` harmlessly (`categoryIconId`'s existing fallback), so
  this can land before or after the icon art without breaking anything.

### Savings: keep the residual, tighten the pointer to Goals

Not rebuilding Savings as a third, assignable-target mechanism. The app
already has one: a Goal (e.g. "Emergency fund," target amount, target
date) pulled into the budget as a planned line via the existing
"include commitments" toggle. That's the assignable-target path
competitors offer; the residual Savings row is a different, genuinely
useful thing — "here's what you actually kept," computed automatically
rather than guessed at. Change: update `budget.savingsHint`'s copy to
name Goals explicitly (e.g. "What's left after expenses. Set a specific
savings target in Goals.") so the two mechanisms read as complementary
rather than one being an undiscovered duplicate of the other.

## Part 2: Create/use flow

### The core idea: one component, two computed modes

No new page, route, or wizard. `BudgetTab` derives a mode from state it
already has:

```
assignMode = !isPastMonth && (!hasIncome || unassigned !== 0)
trackingMode = !assignMode
```

- **Current or future month, not yet fully assigned** → assign mode.
  Positive or negative `unassigned` both count — an over-assigned month
  still has a decision to make.
- **Current or future month, `unassigned === 0`** → tracking mode.
- **Any past month** → always tracking mode, regardless of its
  `unassigned` value. A past month's setup is moot; what matters looking
  back is what happened, not re-running the assignment loop.

This is a pure display-layer derivation in `BudgetTab.jsx` — `unassigned`
itself is still `budget_calc::summarize_month`'s number, untouched.
Nothing about `build_month`, storage, or the calc crate changes for this
part; CLAUDE.md's "business logic lives in Rust" isn't in tension here
because *which mode to render* is UI-only classification of a
Rust-computed number, not a new calculation.

### Assign mode

- **Progress ring replaces the current text-only banner** as the
  dominant visual: a circular indicator showing
  `min(total_planned, income) / income` filled, with the existing
  banner text (start with income / assign $X / fully assigned /
  over-assigned) as a label under or beside it rather than the sole
  cue. A circle reads more clearly as "filling up" at a glance than a
  bar; if it turns out to fight the 375px layout during implementation,
  fall back to a horizontal bar using the same fill fraction and color
  logic — same color logic as today either way (green on track, red if
  over-assigned).
- **First-run category picking becomes tap-to-add chips**, not one
  all-or-nothing "Add common categories" button. Each of the 16 presets
  renders as a chip (name + icon); tapping one adds just that category
  and the chip disappears from the picker (already-added categories
  aren't offered again, mirroring today's name-based dedup). The
  "Add category" hand-typed form stays, for anything not in the preset
  list. This directly answers the Goodbudget-sourced finding that
  dumping all starter categories on a first-time user at once
  front-loads more decisions than necessary — someone can now add the
  three or four they recognize and stop.
- Category rows keep today's planned-amount input, spend/received actual,
  and remaining — nothing about logging a transaction changes in this
  mode.

### Tracking mode

- The planned-amount column and the "add category" form collapse into a
  `<details>` section (same disclosure pattern already used for the
  upcoming-recurring and commitments panels — no new interaction
  pattern introduced), labeled something like "Edit this month's plan,"
  open on demand rather than always-visible once a month is fully
  assigned. Nothing is deleted or hidden permanently — it's one tap away,
  same as those two existing panels.
- **A bottom-anchored "+" becomes the primary action**, replacing
  reliance on the small per-row "+" as the only way to log spending. It
  opens the same existing inline quick-add form (amount, description,
  category to attribute it to) that today's per-row button opens — this
  is a more prominent entry point to unchanged functionality, not a new
  form. Bottom placement satisfies this repo's mobile-first rule
  (thumb-reachable primary action) and directly targets the
  manual-entry friction research calls out as the top reason people
  abandon these apps — the goal isn't removing manual entry (this app
  has no bank sync and won't), it's making the one entry point as fast
  and reachable as possible.
- Category rows keep their remaining/progress-bar display exactly as
  today; only the planned-input's visibility changes.

### What doesn't change

- `build_month`, `summarize_month`, `build_savings_line` — no `budget-calc`
  changes for this part.
- The category table's sort order, section headers (Income/Expense),
  per-row remaining/progress-bar logic, the recurring-upcoming panel, the
  commitments panel, and the spend chart at the bottom — all unchanged.
- Logging a transaction still always dates it "today," per the existing,
  deliberate constraint (see `BudgetTab.jsx`'s own comment on this).

## Testing plan

- `budget-calc`: update the preset-count and content tests in
  `presets.rs` for 16 presets; existing structural tests
  (`no_category_is_offered_twice`, `is_income_always_agrees_with_the_
  group_it_was_declared_under`, etc.) continue to guard the new entries
  for free.
- `www/src/i18n`: `presets.test.js` and `catalogs.test.js` must pass
  with all three catalogs carrying the new/renamed keys.
- `www/src/components`: new tests for the assign/tracking mode
  derivation (past month always tracking; current month flips at
  `unassigned === 0`; over-assigned stays in assign mode) and for the
  chip picker (tapping a chip adds exactly that category and only that
  category, doesn't re-offer an already-added preset).
- `CategoryBadge.test.jsx` gets two new cases for the added preset keys'
  icon/color lookups.
- Manual: verify both modes at 375px width (this repo's mandated mobile
  check) — the progress ring must not overflow, the bottom "+" must sit
  in the thumb zone without covering content, and the `<details>`
  collapse must not fight the page's own scroll.

## Suggested phasing

Two rounds, matching this repo's one-PR-per-round convention:

1. **Categories** — self-contained (presets.rs, three i18n catalogs,
   categoryVisuals.js, savings hint copy). Low risk, ships value
   immediately, unblocks nothing else.
2. **Flow** — the assign/tracking mode split, progress ring, chip
   picker, and bottom "+". Larger diff, benefits from categories already
   being in place (more presets to show as chips).

`writing-plans` can decide whether these stay two PRs or the plan
sequences tasks within one, but they're written here as independently
shippable in case that split is useful.
