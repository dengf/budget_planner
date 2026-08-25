# Budget Planner

Zero-based monthly budgeting, client-side CSV import, savings goals, and
snowball/avalanche debt payoff — meifio's second tool, built as a web app
with a pure Rust calculation core compiled to WebAssembly.

**A build to verify locally before it is deployed anywhere** — this repo has
not been pushed to a remote yet. See `npm start` below.

## What it is, and what it deliberately is not

Every competitor in this space — YNAB, Monarch, Copilot, even the open-source
Actual Budget — differentiates on how much of your financial life it can pull
in: bank aggregation, SGFinDex, a self-hosted sync server. This tool goes the
other way. **It will never call a bank, an aggregator, or any API.** Same
promise as [the mortgage calculator](https://dengf.github.io/mortgage_calculator/),
verified the same way: open your browser's network tab and watch it stay
empty while you use every tab.

That constraint is the design, not a missing feature:

- **CSV import beats bank-sync's convenience without its trust surface.**
  Drop a statement your bank already lets you export. It's parsed entirely in
  your browser, categorized against rules you can read and edit, and none of
  it is ever uploaded.
- **No self-hosted sync server**, unlike Actual Budget. This is a static
  page — the whole app is files on GitHub Pages.
- **Everything you enter stays on your device**, written to IndexedDB in your
  own browser. Clearing site data removes it for good.
- **No shame language.** Overspending a category reads as "borrowed from next
  month," not a red error. A savings goal fills the brand's own plum blossom,
  one petal at a time, rather than a generic progress bar — see
  `crates/budget-calc/src/goals.rs`.

## Features

- **Budget**: zero-based monthly allocation — every category gets a planned
  amount, planned vs. actual, with over/underspend reframed rather than
  flagged as an error
- **Transactions**: manual entry, plus CSV import with an editable
  keyword-based categorization rule set
- **Goals**: sinking funds with required-contribution math, progress shown as
  the brand blossom filling in, one-time milestone acknowledgements (not
  streaks)
- **Debt payoff**: snowball (smallest balance first) or avalanche (highest
  rate first), full month-by-month schedule, reusing the amortization
  arithmetic proven out in the mortgage calculator
- **Report**: a printable monthly summary, with a pre-filled mail draft —
  nothing is sent from this page; a `mailto:` link hands off to your own
  mail client
- **Three languages**: English, 简体中文, 繁體中文

## Architecture

Same layered shape as [mortgage_calculator](https://github.com/dengf/mortgage_calculator),
independently implemented rather than sharing a crate — see `CLAUDE.md` for
why.

```
crates/
  budget-core      shared vocabulary: Cadence, Region, rounding, errors
  budget-calc      every calculation -- allocation, rules, CSV import,
                    goals, debt payoff. No I/O, no clock, no randomness.
  budget-ports     the BudgetStore trait and record types, no backend
  budget-ext-redb  redb on disk (native) / redb-over-IndexedDB (wasm32)
  budget-wasm      thin wasm-bindgen bridge -- parses, calls, serializes
www/               React + webpack front end
```

`budget-calc` has zero dependencies on wasm, the DOM, or a clock — every
function takes what it needs as an explicit argument (an `as_of` date, a
`next_id` generator), which is what makes a debt payoff schedule or a
milestone crossing a five-line unit test rather than something you have to
click through a browser to check.

## Run it

```bash
cd www
npm install
npm start          # builds the wasm, starts the dev server
```

```bash
npm test           # frontend unit tests
npm run build:wasm && npm run build   # production build
```

```bash
cargo test --workspace                              # Rust tests
cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings
cargo build -p budget-wasm --target wasm32-unknown-unknown   # see CLAUDE.md
```

## Privacy

No accounts, no server, no analytics of any kind. See `www/static/privacy.html`
once deployed, or read it directly in this repo.

## License

MIT — see `LICENSE`.
