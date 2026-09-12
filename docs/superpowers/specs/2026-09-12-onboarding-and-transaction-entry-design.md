# Onboarding and Transaction Entry Design

## Purpose

Make the first useful budget and the first transaction easy to complete on
desktop and phone, without weakening Budget Planner's local-only or
zero-based-budgeting model.

## Scope

This release improves two connected React user journeys:

1. A new or reset budget moves from no user data to a usable monthly plan.
2. A user records or imports a transaction with an unambiguous direction.

The work does not change any money calculation, allocation rule,
categorization rule, or storage schema. It adds one narrow Rust/WASM category
catalogue interface for the compact initial preset set.

## Product constraints

- All calculations remain in Rust (`budget-calc`) and cross the existing
  WASM boundary unchanged.
- Category-taxonomy decisions remain in Rust. The compact initial preset list
  is defined once in `budget-calc`, then exposed by a thin WASM binding.
- React/JS is responsible only for rendering, input collection, formatting,
  and local interaction state.
- The app remains static, local-only, and analytics-free. No network calls or
  accounts are added.
- English, Simplified Chinese, and Traditional Chinese stay complete.
- Existing IndexedDB data is preserved exactly.
- The current dark/light visual language and five-tab primary navigation stay
  in place.

## First-run budget experience

### Setup state

The Dashboard derives its next action from the existing in-memory
collections. It does not save a separate onboarding-complete flag.

| Condition | Dashboard state | Primary action |
| --- | --- | --- |
| No categories | Plan income | Open Budget with income planning visible |
| Categories but no planned income for the viewed month | Plan income | Open Budget |
| Planned income exists and the zero-based allocation is incomplete | Assign remaining money | Open Budget |
| Allocation is complete and the viewed month has no transactions | Log a transaction | Open Transactions sheet |
| Otherwise | Existing dashboard summary | Existing dashboard actions |

The setup state is a compact checklist that shows the current step and the
next action. It replaces the empty dashboard's large zero-value summary and
empty chart. Once the budget has meaningful activity, the existing dashboard
presentation remains the default.

### Starter categories

The auto-seeded first-run and post-reset category list changes from the full
preset catalogue to this compact essential starter set:

- `cat.primaryEarnedIncome`
- `cat.housing`
- `cat.utilities`
- `cat.foodGroceries`
- `cat.transportation`

`budget-calc` defines this set from the canonical preset taxonomy, and a thin
WASM binding exposes it to React. The current full-preset binding remains the
source for the category picker, so users can add every remaining category.
Existing saved categories are never removed, renamed, reordered, or
reclassified. A budget that already has categories keeps its current list.

### Budget screen

Budget keeps its current arithmetic and per-category entry mechanics. On
mobile it prioritizes income and the compact starter categories first, while
the complete catalogue remains behind the explicit category-add action. Long
category descriptions stay available without making every initial row compete
for vertical space.

## Transaction entry experience

### Entry mode

The Add Transaction sheet exposes an explicit, labelled `Expense` / `Income`
choice before the amount field. Both modes accept a positive amount. The
React input adapter serializes the selected expense as the existing negative
transaction value and the selected income as the existing positive value.
This is input normalization only; Rust remains the authority for all resulting
figures.

The primary submit label changes with the selected mode (`Add expense` or
`Add income`). The amount helper describes the selected mode rather than
teaching users to type a negative number. Categories shown in the selector are
limited to the matching income or expense category type, with the existing
uncategorized option still available when appropriate.

### Transaction-tab hierarchy

Manual entry and CSV import are the first, prominent actions in the empty and
populated transaction experiences. Categorization rules and recurring expense
setup remain supported, but are visually secondary and progressively disclosed
after the primary logging/import workflow and transaction history.

## Responsive and accessible behavior

- The fixed phone navigation reserves bottom content space, including focus
  clearance for the final interactive control on every tab and in sheets.
- Every new or changed control has a visible label or an accessible name,
  clear selected/expanded state, keyboard operation, and a touch target that
  remains practical on a 375px-wide phone.
- The revised dark and light surfaces, helper text, form labels, focus rings,
  and state indicators meet applicable contrast requirements. Direction is
  expressed with text as well as color.
- Sheets retain a clear dismiss action and do not obscure keyboard focus.
- Motion is limited to meaningful state changes, uses existing reduced-motion
  handling, and does not block input.

## Components and responsibilities

| Area | Responsibility |
| --- | --- |
| `crates/budget-calc/src/presets.rs` | Define and test the compact essential starter preset set from the canonical category taxonomy. |
| `crates/budget-wasm/src/presets.rs` | Add a thin binding that serializes the compact starter set without duplicating category selection logic. |
| `www/src/App.jsx` | Seed compact first-run presets and derive setup readiness from loaded collections. |
| `www/src/components/DashboardTab.jsx` | Render the setup checklist/next action or the established dashboard summary. |
| `www/src/components/BudgetTab.jsx` | Prioritize starter categories and retain the existing planning interface. |
| `www/src/components/CategoryChipPicker.jsx` | Keep the full preset catalogue intentionally discoverable after setup. |
| `www/src/components/AddTransactionSheet.jsx` | Collect explicit entry type, normalize the amount for the existing payload, filter categories, and change entry copy. |
| `www/src/components/TransactionsTab.jsx` | Establish logging/import as primary and progressively disclose rules and recurring setup. |
| `www/src/i18n/*.js` | Localize every new visible and accessible string. |
| `www/src/styles/main.css` | Implement responsive layout, bottom-bar clearance, contrast, focus, and reduced-motion-safe visual states. |

## Data and migration behavior

There is no data migration. No database record shape changes. A previously
saved budget follows the normal dashboard path based on its existing data. A
new install or an explicit clear/reset receives the compact starter set. CSV
imports, backups, recurring transactions, categorization rules, goals, and
debts retain their current formats and behavior.

## Validation

- Add Rust tests for the compact starter-set membership and for preserving the
  complete preset catalogue separately.
- Add frontend tests for the derived setup states and their actions.
- Test compact first-run seeding without altering an existing category list.
- Test expense/income mode labels, positive amount normalization, matching
  category choices, and submit payloads.
- Test transaction hierarchy and progressive disclosure.
- Extend i18n validation so new English strings exist in all three catalogues.
- Run the relevant Rust tests, frontend test suite, lint, formatting check,
  the required wasm32 build, and the production build.
- Manually verify desktop plus 375px and 390px phone layouts, keyboard access,
  focus visibility, dark/light contrast, and reduced-motion behavior.

## Out of scope

- Bank sync, accounts, telemetry, analytics, or server-side storage.
- Changes to Rust calculations or IndexedDB schemas beyond the narrow
  starter-preset catalogue binding.
- A mandatory multi-page onboarding wizard.
- Changes to goal, debt payoff, CSV parsing, receipt capture, or report
  calculations beyond their existing navigation entry points.
