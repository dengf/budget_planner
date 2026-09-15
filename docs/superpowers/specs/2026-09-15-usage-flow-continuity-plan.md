# Usage-flow continuity: closing the loops that never close

**Date:** 2026-09-15
**Status:** Plan only. No implementation in this round.
**Method:** Walked the whole flow as a first-time and as a returning user,
driving the real app (headless Chrome over CDP against the dev server at
375x812, touch emulated). Screenshots referenced below were captured from
that session, not mocked up.

## The finding, in one sentence

Everything inside a single month is well built; nothing between months is
built at all — and the transaction stream the user feeds daily never
reaches the three features that are waiting for exactly that data.

## Evidence

Driving the app forward one month, with a September plan already saved:

| Screen | What it shows |
|---|---|
| `04-budget-income-planned` | September: income $5,000 planned, banner reads "Now assign your $5,000.00 across the categories below." |
| `09-next-month-budget` | October: income $0.00, total planned $0.00, every category `$0.00 of $0.00`, banner reads "Start here — plan how much you expect from each income category below." |
| `08-next-month-dashboard` | October Dashboard offers exactly one action: "Back to September 2026." |

October is byte-for-byte the first-run experience. Confirmed in code:
`previous_remaining: []` at `www/src/useMonthBudget.js:104` and
`www/src/components/DashboardTab.jsx:161`; `budgetPlan` is fetched per
month (`App.jsx`), so a fresh month simply has no plan rows.

Second structural gap, confirmed by call-site audit: `transactions.save`
is called from only four places — `AddTransactionSheet` (manual, CSV),
`ReceiptCapture` (x2), and `RulesSection.applyRules`. **No code path edits
an existing transaction.** Deleting and retyping is the only correction.

Third: `debts.balance` and `goals.current_amount` are hand-typed numbers.
No transaction ever moves either one.

## The arcs, and where each one breaks

| Arc | State |
|---|---|
| First session (setup ladder) | Works well. Three steps, one tap each, ends on the Savings figure. |
| Daily logging | The strongest part. Centre "+", amount-first, category pre-guessed, submit quotes the sentence back. |
| Correction | **Missing entirely.** No edit. Bulk "Apply rules" is two levels deep in More and only fixes keyword matches. |
| Weekly glance | Works. |
| Month end | **Nothing happens.** No summary, no comparison, no close. |
| Month start | **The cliff.** Full manual re-entry of every planned amount, every month, forever. |
| Goals / Debt / Recurring | **Open loops.** Each asks for setup and then never receives data back. |

## Round 1 — Make the month boundary real (highest leverage)

Two halves. Ship together; they are the same moment seen from either side.

### 1a. Month start: carry the plan forward

When the viewed month has no plan rows and an earlier month does, the
Budget tab's assign banner and the Dashboard ladder both offer
**"Start from September's plan"** — one tap seeds this month's planned
amounts from the most recent month that has them. Everything stays
editable; this is a starting point, not a lock.

- **Rust:** `month_setup_state` gains a variant for "no plan yet, but a
  previous plan exists" — the decision of which headline a month gets is
  already this function's job (`budget-calc/src/category.rs`), and putting
  the new branch anywhere else re-creates the exact frontend-ternary bug
  its doc comment documents. A `carry_plan_forward(previous_entries,
  target_month)` helper produces the new entries.
- **Frontend:** new ladder step + banner action; no new screen.

### 1b. Month end: a closing moment

A month that has ended and has transactions gets a retrospective hero
instead of the ordinary figures: what was planned versus what happened,
the two or three categories that differed most, and the same
**"Carry this plan into October"** button.

- **Rust:** `month_review(lines, summary)` returning the comparison facts
  (largest overspend, largest underspend, saved versus planned). Choosing
  which facts are worth stating is a ruleset decision and belongs in
  `budget-calc` with tests, not in a `.jsx` sort.

### Explicitly NOT in Round 1

**True envelope rollover** — carrying *unspent balances* forward via
`previous_remaining` — is a different and larger feature. `build_month`
already accepts it, but it changes what every figure in the app means.
Round 1 copies *the plan*, not *the leftover money*. Keep them separate
rounds so the second one can be reasoned about on its own.

## Round 2 — Close the correction loop

1. **Tap a transaction to edit it.** Amount, date, note, category. Reuse
   the `AddTransactionSheet` shape rather than inventing a second form;
   `transactions.save` already upserts by id, so the storage side needs
   nothing new.
2. **"Uncategorized (N)" filter on Transactions.** After a CSV import the
   leftovers are currently invisible and unfixable. This makes cleanup a
   visible, finishable job.
3. **"Make a rule from this" on a transaction.** Rules are currently
   written from a blank keyword box in More — two levels away from the
   moment the need is felt. This is where the differentiator (CSV import,
   the anti-bank-linking bet) actually gets good: every correction teaches
   the next import.

## Round 3 — Connect the open loops to the transaction stream

- **Goals:** a one-tap "add this month's savings to this goal" fed by the
  Savings figure the Dashboard already computes. Today the blossom — the
  brand's emotional payoff — is driven by a number the user hand-maintains.
- **Debt:** a "record a payment" action that both creates the transaction
  and reduces the balance. Today the payoff chart projects from a frozen
  balance, so after six months of real payments it shows the original
  debt-free date with full confidence. That is a confident wrong number,
  which `CLAUDE.md` ranks with a miscalculation.
- **Recurring:** "mark as paid" on an upcoming occurrence, creating the
  transaction. Today a recurring expense produces no visible feedback
  anywhere on the four main tabs.

## Round 4 — The log-first on-ramp

A first-time budgeter does not know their grocery number. After N
transactions exist with no plan, offer **"build a budget from what you've
spent"**, proposing planned amounts from actuals. The `spent_so_far` state
already tolerates this user; today it only ever nudges them back toward
planning and never lets them finish.

## Cleanup riders (small, found in passing)

- `budget.spentHint` reads "use + on a row to log one here." Budget rows
  have no "+" — tapping a row opens the plan sheet. Visible in
  `04-budget-income-planned` and `09-next-month-budget`. Stale since the
  Round 4 row-list redesign (#84).
- `RulesSection.jsx:15` and `ReceiptCapture.jsx:91` both refer to
  "TransactionsTab's own Apply rules button", which no longer exists
  there — it lives in More → Rules now.

## Sequencing rationale

Round 1 is what keeps someone past month two; without it the tool asks for
a full re-setup twelve times a year. Round 2 is what makes the headline
feature finishable. Rounds 3 and 4 raise the ceiling but neither one
matters if the user is gone by November.
