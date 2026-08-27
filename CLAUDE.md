# Working in this repo

## The rule: business logic lives in Rust

Every calculation, rule, threshold and derived figure belongs in the Rust
crates. The front end renders results and collects input. It does not
compute.

- **The tests are in the core.** `budget-calc` carries the entire
  budgeting logic — zero-based allocation, categorization rules, CSV
  parsing, sinking-fund contribution math, snowball/avalanche payoff
  ordering. A rule that migrates into a `.jsx` file is covered by none of
  it, and nothing fails when it drifts.
- **The boundary is what makes the core reviewable.** `budget-wasm` is
  plumbing precisely because no decision hides in it.

When a duplicated rule does drift, the app does not crash: it shows a
confident, wrong number. A budgeting tool that is quietly wrong is worse
than one that is visibly broken.

### Where a thing goes

| Layer | Owns |
|---|---|
| `budget-core` | Shared vocabulary: `Cadence`, `Region`, rounding, errors |
| `budget-calc` | Every calculation: allocation, rules, CSV import, goals, debt payoff |
| `budget-ports` / `budget-ext-redb` | Persistence port + redb/IndexedDB adapter |
| `budget-wasm` | Bridge only. Parse `JsValue`, call `budget-calc`, serialize back |
| `www/` | Layout, input, formatting for display, i18n |

Business logic is anything where a second implementation could give a
different answer: arithmetic on money, thresholds, deriving one value from
another, choosing between rulesets. Host layer is anything a wasm module
cannot reach or has no domain content: reading `localStorage`/`FileReader`,
DOM/layout/SVG geometry, number and date *formatting* for display.

`www/src/region.js` and `www/src/income.js` are host-layer by design, not
by omission — see their own doc comments for why: region here carries no
regulatory ruleset the way mortgage_calculator's does, and income is a
number the person types, not something derived.

### Adding a calculation

1. Write it in `budget-calc`, with tests.
2. Add a binding in `budget-wasm` that only parses, calls and serializes.
   The `bridge_coverage` test fails if a public `budget-calc` module has no
   binding.
3. Call it from the front end.

## Carried over from mortgage_calculator, verified still true here

- **The blossom is the brand's one constant, and it has five petals, not
  six.** `goals::petals_filled` divides progress into fifths, matching
  `meifio-brand/build.py`'s `PETAL` at 72 degrees (five-fold). This was
  wrong once already this session — written as six from a planning
  document's loose wording, caught by checking the actual shipped
  `MeifioMark.jsx` rather than trusting the plan. Check the real asset
  again if this ever needs revisiting.
- **`Decimal` has no NaN or Infinity.** Don't write `.is_finite()` on a
  `Decimal` — it doesn't exist, and the compiler will say so. The
  non-finite case belongs at the wasm boundary, converting the `f64` a JS
  caller sent (`convert::f64_to_decimal`), mirroring mortgage-wasm's
  `percent_to_rate`.
- **The `Message` convention**: an error crosses the wasm boundary as a
  code plus params plus an English fallback, never as pre-composed prose —
  see `budget-wasm/src/message.rs`.
- **`no_debug_formatted_errors`**: every binding module must serialize via
  `convert::to_js`, never `serde_wasm_bindgen::to_value`, and must never
  Debug-format an error into a user-facing field. Guarded by a source-text
  test in `message.rs`; the `BINDINGS` list there must include every new
  binding module.
- **A proper noun is exempt from the untranslated-strings guard by exact
  match, never by loosening the pattern.** `meifio` is exempted this way in
  `untranslated-strings.test.js`; an identical-in-every-locale value like
  an email placeholder gets the same treatment in
  `i18n/catalogs.test.js`'s `PROSE_EXEMPT` — both documented in place, both
  narrow.
- **Never round-trip the i18n catalogs through anything that isn't
  UTF-8-in, UTF-8-out.** A test bans the Latin-1-supplement range
  (hex 80 through FF) across all three catalogs; a single mis-encoded
  write turns Chinese text into mojibake that passes every other check.

## The other rule: it has to be obvious to use

Near-perfect, intuitive user experience is a requirement for every tool we
ship, not a polish pass afterwards. A tool that is correct but confusing
has not been delivered.

What this means in practice:

- **Someone opening it for the first time must know what to do next**
  without being told. If the first screen doesn't make the next action
  obvious, that is a defect and gets logged like any other.
- **The number the tool exists to produce is the most prominent thing on
  the screen.** Supporting figures are subordinate to it.
- **Never state something that isn't true yet.** A success message on an
  empty state, a total that omits data, a phrase that only makes sense
  once the user has done something they haven't done -- these are wrong
  answers, not cosmetic issues, and rank with a miscalculation.
- **Defaults must reduce work, not just fill space.** Seeding a screen
  with rows of zeros only helps if the next action is still obvious.
- **Every destructive action confirms; every reversible one is quiet.**
  Visual weight goes to the action people take most, never the rarest one.
- **If it can be exported it must be importable.** A one-way door beside
  a delete button is a trap.
- **Check it on a phone before calling it done.** Layout bugs in this
  codebase have shown up on narrow screens first, more than once.

When a change is reviewed, "does this work?" and "would a first-time user
understand this?" carry equal weight. The second question is the one that
gets skipped, so ask it explicitly.

## Verification traps specific to this repo

- **`cargo build --workspace` never compiles `budget-ext-redb::wasm` or
  `budget-wasm::storage`.** Both are gated to `wasm32-unknown-unknown` and
  only exist on that target. Two real bugs shipped past a clean native
  build this session — a missing `serde::Serialize` derive on two DTOs —
  and were only caught by `cargo build -p budget-wasm --target
  wasm32-unknown-unknown`. CI runs this as its own `wasm32` job rather than
  relying on the slower `www-build` job to exercise it indirectly; run it
  locally before trusting a green native build.
- **`npm run build` does not rebuild the wasm.** Run `npm run build:wasm`
  first, or you are testing the previous `pkg/`.
- **jsdom has no `localStorage`** on `window` or as a bare global; every
  storage path (`region.js`, `income.js`) runs into its catch block under
  test unless the test stands up a fake.
- **`wasm-opt` is off deliberately**, same measured tradeoff as
  mortgage_calculator's `mortgage-wasm/Cargo.toml` — see that crate's
  comment. Do not "fix" it here either.
- **`window.prompt`/`window.alert` are not available in every environment
  that renders this app** (including this project's own browser-preview
  tooling) and are poor UX regardless — blocking, unstyled, untestable.
  Every interaction in this app uses an inline control instead; keep it
  that way.
- **A new category has no budget-plan entry until one is saved.**
  `BudgetTab` builds its `planned` list from every known category
  (defaulting to 0), not from `budgetPlan.items` alone — the latter would
  make a freshly-added category invisible until something else created a
  plan row for it. This was a real bug caught in the first browser smoke
  test; don't reintroduce it by "simplifying" back to filtering on
  `budgetPlan.items`.

## What's simplified in this round, on purpose

- **`previous_remaining` (rollover) is always `[]`.** Every month is
  planned independently; `budget_calc::build_month` already accepts a
  prior month's remaining balances, but the frontend doesn't yet carry
  them forward month-over-month. That's real, sizeable state (finding and
  summing the actual previous month) for a follow-up round, not a Rust
  limitation.
- **No shared crate with `mortgage_calculator`.** Both repos independently
  implement the same *pattern* (hexagonal storage port, redb-over-
  IndexedDB, the `Message` convention) rather than sharing code, so the two
  apps' release cycles stay decoupled. Revisit only once the pattern has
  proven stable across a third tool.

## Landing changes

One branch per round of work, focused commits, then a PR with a Summary
and Test plan. **Do not self-merge** — wait for approval. Verify
`state == "MERGED"` before deleting any branch.

### Tunneling a local preview for the user to look at

Use **`cloudflared tunnel --url http://localhost:3002`** (the dev
server's port, per `webpack.config.js`), not `localtunnel`/`lt`.
`cloudflared`'s quick tunnel (`*.trycloudflare.com`, no account or config
needed) opens straight to the app; `localtunnel` interposes its own
"Tunnel website ahead!" interstitial that requires typing in a shown IP
address before every first visit from a given network, which is exactly
the kind of avoidable step to skip when the point is a quick look. Read
the assigned `https://*.trycloudflare.com` URL from `cloudflared`'s own
stdout (`INF ... Your quick Tunnel has been created! ... https://...`)
rather than guessing it. `devServer.allowedHosts: 'all'` in
`webpack.config.js` is already set to accept a tunnel's Host header, for
either tool.

**Never push to a remote, or run `gh repo create`, without the user asking
in that exact moment** — a plan having said the repo would be public is
not the same as permission to publish it. Build, commit and test locally;
ask before the first push.
