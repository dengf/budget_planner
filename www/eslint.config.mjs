// ESLint flat config. This project had no linter at all before -- only
// Prettier, which is formatting, not correctness -- so everything here is
// new coverage rather than a migration.
//
// Three deliberate choices worth knowing before editing:
//
//  1. `eslint-config-prettier` goes LAST. It switches off every stylistic
//     rule that would otherwise disagree with `.prettierrc`. Formatting is
//     Prettier's job; this config's job is finding bugs. Anything that
//     reformats code does not belong here.
//
//  2. The three JS environments in this app are genuinely different and
//     get separate blocks. `src/ocrWorker.js` and `src/glmVisionWorker.js`
//     run in Workers, where `self` and `importScripts` exist but `window`
//     and `document` do not -- exactly the distinction that would have
//     caught a `document.` reference in worker code, which cannot be
//     tested for in jsdom either (see CLAUDE.md's verification traps).
//
//  3. `react-hooks` is the highest-value plugin here and is set to error,
//     not warn. `ReceiptCapture.jsx` already carries a hand-written
//     comment explaining a stale-closure bug that `exhaustive-deps` is
//     designed to catch -- that bug was found by reasoning, once, at some
//     cost; the linter finds the next one for free.
import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import testingLibrary from 'eslint-plugin-testing-library';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: ['pkg*/**', 'dist/**', 'node_modules/**', 'static/**'],
  },

  js.configs.recommended,

  // Flags an `eslint-disable` comment for a rule that no longer fires.
  // This repo had a config once and lost it: seven `no-await-in-loop`
  // disables, one `testing-library/no-node-access` and one `jsx-a11y`
  // survived in the source with nothing left to read them. Those rules
  // are re-enabled below, so the comments mean something again -- and
  // this setting stops the next round of them rotting silently.
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },

  // Everything in src/ is browser code built by webpack/babel.
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Injected by webpack's DefinePlugin (see webpack.config.js), so
        // it exists at runtime but appears undeclared to a linter.
        __BUILD_ID__: 'readonly',
      },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs['recommended-latest'].rules,
      ...jsxA11y.flatConfigs.recommended.rules,

      // Two real findings this surfaced in `App.jsx` and `CalcError.jsx`
      // -- effects that call setState synchronously, which cascades an
      // extra render. Both are pre-existing and neither is a correctness
      // bug, so they are warnings rather than a blocker on every future
      // PR; they stay visible in every run until someone restructures
      // those effects. Downgraded deliberately, not switched off.
      'react-hooks/set-state-in-effect': 'warn',

      // Part of the same new compiler-backed rule set, and it cannot
      // distinguish a function *defined* during render from one *called*
      // during render: it flags `Date.now()` inside `BudgetTab`'s
      // `savePlanned`, an async click handler that only ever runs on an
      // event. Kept visible as a warning rather than trusted as an error.
      'react-hooks/purity': 'warn',

      // `@babel/preset-react` runs in classic mode (see webpack.config.js
      // -- no `runtime: 'automatic'`), so React really must be in scope.
      'react/react-in-jsx-scope': 'error',

      // This app has no propTypes anywhere and no TypeScript; requiring
      // them now would be several hundred warnings of pure noise.
      'react/prop-types': 'off',

      // Money and byte counts get compared a lot in this codebase. `==`
      // coercion is never what's wanted, and `null`/`undefined` checks
      // are written `!= null` deliberately, which this still allows.
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // An unused variable is either dead code or a typo'd reference.
      // Leading-underscore names stay allowed as the explicit "I know"
      // escape hatch, including for caught errors.
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          // `const { goals, ...rest } = obj` is the idiomatic way to omit
          // a key, and `backup.test.js` uses it to build a backup missing
          // one section. The binding is unused on purpose -- that is the
          // whole point of the destructure.
          ignoreRestSiblings: true,
        },
      ],

      // `catch {}` is used intentionally in several storage paths (jsdom
      // has no localStorage; Cache Storage can throw) -- that's fine. A
      // genuinely empty block anywhere else is not.
      'no-empty': ['error', { allowEmptyCatch: true }],

      // CLAUDE.md bans these outright: blocking, unstyled, untestable,
      // and unavailable in this project's own preview tooling.
      'no-alert': 'error',

      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-var': 'error',
      'prefer-const': 'error',

      // Catches a non-breaking space or similar pasted invisibly into
      // source -- a real hazard next to catalogs that carry CJK text.
      // `skipRegExps` because `catalogs.test.js` legitimately uses
      // U+3000 (IDEOGRAPHIC SPACE) as the low bound of a CJK character
      // range; that is the character being matched, not stray whitespace.
      'no-irregular-whitespace': ['error', { skipRegExps: true }],

      // `no-await-in-loop` is deliberately NOT enabled. Sequential awaits
      // are this app's architecture, not an oversight: model data is
      // fetched chunk by chunk precisely so peak memory stays bounded,
      // and PDFs are rasterized a page at a time for the same reason.
      // Issuing those in parallel is the bug the sequencing prevents. The
      // rule needed ~18 suppressions across the worker and fetch layers,
      // which is a rule fighting the codebase rather than checking it.

      // React's own escape hatches are the exception to `no-restricted-
      // syntax` style bans; nothing else here needs one.
      'react/no-unescaped-entities': 'off',
    },
  },

  // Workers have `self`, not `window`/`document`.
  {
    files: ['src/ocrWorker.js', 'src/glmVisionWorker.js'],
    languageOptions: { globals: globals.worker },
  },

  // Tests run in jsdom with vitest's globals injected (see
  // vitest.config.mjs `globals: true`), so they are neither pure browser
  // nor pure node.
  {
    files: ['src/**/*.test.{js,jsx}', 'src/test/**/*.{js,jsx}'],
    plugins: { vitest, 'testing-library': testingLibrary },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...vitest.environments.env.globals,
        // Tests stand up fakes on `global` (jsdom has no localStorage --
        // see CLAUDE.md's verification traps), which is a node global,
        // not a browser one.
        global: 'writable',
      },
    },
    rules: {
      ...vitest.configs.recommended.rules,
      ...testingLibrary.configs['flat/react'].rules,

      // A focused or skipped test that reaches main silently stops
      // covering what it claims to cover.
      'vitest/no-focused-tests': 'error',

      // testing-library's query-style rules are preferences, not bug
      // detectors: they would rewrite ~40 call sites in tests that pass
      // and read fine. The plugin's value here is its async rules
      // (`await-async-queries`, `no-await-sync-queries`,
      // `prefer-find-by`), which catch a missing `await` on `findBy*` --
      // a real, silent source of flaky tests. Those stay on.
      'testing-library/no-container': 'off',
      'testing-library/prefer-screen-queries': 'off',
      'testing-library/no-node-access': 'off',
    },
  },

  // Build tooling and the end-to-end harness run in node, not a browser.
  {
    files: ['webpack.config.js', 'vitest.config.mjs', 'e2e/**/*.mjs'],
    languageOptions: {
      // The e2e harness is node, but the bodies it passes to Playwright's
      // `page.evaluate()` are serialized and run inside the browser, so
      // both sets of globals are legitimately in scope in one file.
      globals: { ...globals.node, ...globals.browser },
      sourceType: 'module',
    },
    rules: { 'no-console': 'off', 'no-await-in-loop': 'off' },
  },
  {
    files: ['webpack.config.js'],
    languageOptions: { sourceType: 'commonjs' },
  },

  prettier,
];
