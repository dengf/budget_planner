# Budget Categories Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the Budget tab's 14 starter categories to 16 (add "Subscriptions & Memberships" and "Gifts & Donations"), rename three CPA-formal labels to plain language, and give the two new presets their own badge icon/color — Part 1 of the Budget tab redesign.

**Architecture:** All category *content* (names, groups, descriptions) lives in `budget-calc/src/presets.rs` per this repo's "business logic lives in Rust" rule — even a taxonomy choice is a rule a second implementation could get differently. Everything else (i18n text, icon SVGs, color-index table) is host-layer and lives in `www/`.

**Tech Stack:** Rust (`budget-calc`), React/JSX, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-budget-tab-redesign-design.md` (Part 1: Category taxonomy)

## Global Constraints

- Final counts: **5 income + 11 expense = 16 presets.**
- Renames (`cat.investmentCapitalIncome`, `cat.debtServicing`, `cat.governmentSupplemental`) change only the *displayed* `name` string — the key, `group`/`group_key`, and `is_income` stay exactly as they are today. Do not touch anything else about these three entries.
- **No retroactive migration.** A category a user already saved keeps its stored name/description forever, even if the preset text it came from later changes — this is existing, deliberate behavior (`preset_key` is for icon lookup only, never a live pointer back to preset text). Nothing in this plan writes a migration for existing data, and nothing should.
- All three i18n catalogs (`en.js`, `zh-Hans.js`, `zh-Hant.js`) must carry every `cat.*` key the Rust source declares, or `www/src/i18n/presets.test.js` fails by design — that is the test doing its job, not a bug to work around.
- **`categoryVisuals.js`'s `PRESET_KEY_ORDER` array's existing 14 entries must keep their exact current order and positions.** This array's index is a category's *permanent* color slot for every installation that already exists — reordering or inserting in the middle would silently recolor other people's already-created categories. The two new keys go at the **end** of the array, full stop, regardless of where they logically sit in `presets.rs`'s declaration order.
- Icon SVGs follow `CategoryIcons.jsx`'s existing convention exactly: `viewBox="0 0 24 24"`, spread `ICON_PROPS` (`fill="currentColor"`, `aria-hidden`), solid filled shapes (no stroke), a `fillRule="evenodd"` path for any shape needing a see-through "hole."

---

### Task 1: Add two categories and rename three in `budget-calc`

**Files:**
- Modify: `crates/budget-calc/src/presets.rs`

**Interfaces:**
- Produces: two new preset keys, `"cat.subscriptionsMemberships"` and `"cat.giftsDonations"`, both `is_income: false`, group `EXPENSE`. Later tasks (i18n catalogs, `categoryVisuals.js`) key off these exact strings.

- [ ] **Step 1: Write the failing tests**

Replace the existing count test and add a new one for the two additions, in `crates/budget-calc/src/presets.rs`'s `#[cfg(test)] mod tests`:

```rust
    #[test]
    fn five_income_categories_and_eleven_expense_categories() {
        let presets = starter_categories();
        let income = presets.iter().filter(|p| p.group == "Income").count();
        let expense = presets.iter().filter(|p| p.group == "Expense").count();
        assert_eq!(income, 5);
        assert_eq!(expense, 11);
    }

    #[test]
    fn subscriptions_and_gifts_are_offered() {
        let presets = starter_categories();
        let subscriptions = presets
            .iter()
            .find(|p| p.key == "cat.subscriptionsMemberships")
            .expect("subscriptions preset is offered");
        assert!(!subscriptions.is_income);
        assert_eq!(subscriptions.group, "Expense");

        let gifts = presets
            .iter()
            .find(|p| p.key == "cat.giftsDonations")
            .expect("gifts preset is offered");
        assert!(!gifts.is_income);
        assert_eq!(gifts.group, "Expense");
    }

    #[test]
    fn three_labels_read_in_plain_language_now() {
        let presets = starter_categories();
        let by_key = |key: &str| presets.iter().find(|p| p.key == key).unwrap();
        assert_eq!(by_key("cat.investmentCapitalIncome").name, "Investments");
        assert_eq!(by_key("cat.debtServicing").name, "Debt Payments");
        assert_eq!(by_key("cat.governmentSupplemental").name, "Government Benefits");
    }
```

Delete the old `five_income_categories_and_nine_expense_categories` test entirely — it's superseded by the first test above, not kept alongside it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p budget-calc presets:: --lib`
Expected: FAIL — `subscriptions_and_gifts_are_offered` panics on `.expect(...)` (no such preset yet), `three_labels_read_in_plain_language_now` fails the name assertions, and `five_income_categories_and_eleven_expense_categories` fails on `expense == 9`.

- [ ] **Step 3: Implement the taxonomy change**

In `EXPENSE_CATEGORIES`, rename `cat.debtServicing`'s `name` and insert the two new presets so the array reads, in order:

```rust
const EXPENSE_CATEGORIES: &[PresetCategory] = &[
    preset(
        "cat.housing",
        "Housing",
        EXPENSE,
        false,
        "cat.housing.desc",
        "Rent or mortgage, property taxes, homeowner/rental insurance, HOA fees, repairs.",
    ),
    preset(
        "cat.utilities",
        "Utilities",
        EXPENSE,
        false,
        "cat.utilities.desc",
        "Electricity, gas, water/sewer, trash collection, internet, wifi, mobile phone.",
    ),
    preset(
        "cat.foodGroceries",
        "Food & Groceries",
        EXPENSE,
        false,
        "cat.foodGroceries.desc",
        "Groceries, household supplies, dining out, coffee/drinks.",
    ),
    preset(
        "cat.transportation",
        "Transportation",
        EXPENSE,
        false,
        "cat.transportation.desc",
        "Auto loan/lease, vehicle insurance, gas/EV charging, parking, tolls, transit passes, car maintenance.",
    ),
    preset(
        "cat.healthcareInsurance",
        "Healthcare & Insurance",
        EXPENSE,
        false,
        "cat.healthcareInsurance.desc",
        "Health/dental/vision premiums, pharmacy copays, out-of-pocket medical bills, life insurance.",
    ),
    preset(
        "cat.debtServicing",
        "Debt Payments",
        EXPENSE,
        false,
        "cat.debtServicing.desc",
        "Credit card balances, student loans, personal loans, medical debt payments.",
    ),
    preset(
        "cat.personalLifestyle",
        "Personal & Lifestyle",
        EXPENSE,
        false,
        "cat.personalLifestyle.desc",
        "Clothing/shoes, personal care, hobbies.",
    ),
    preset(
        "cat.subscriptionsMemberships",
        "Subscriptions & Memberships",
        EXPENSE,
        false,
        "cat.subscriptionsMemberships.desc",
        "Streaming services, gym and other memberships, software subscriptions, recurring app fees.",
    ),
    preset(
        "cat.familyDependents",
        "Family & Dependents",
        EXPENSE,
        false,
        "cat.familyDependents.desc",
        "Childcare, tuition, school supplies, extracurricular activities, pet care/vet bills.",
    ),
    preset(
        "cat.giftsDonations",
        "Gifts & Donations",
        EXPENSE,
        false,
        "cat.giftsDonations.desc",
        "Birthday and holiday gifts, charitable donations, tithing.",
    ),
    preset(
        "cat.otherExpenses",
        "Other Expenses",
        EXPENSE,
        false,
        "cat.otherExpenses.desc",
        "Any other expense that doesn't fit the categories above.",
    ),
];
```

Note `cat.personalLifestyle.desc` dropped "gym memberships, streaming services" — that content moved to the new Subscriptions preset.

In `INCOME_CATEGORIES`, rename two entries' `name` (keys/description untouched):

```rust
    preset(
        "cat.investmentCapitalIncome",
        "Investments",
        INCOME,
        true,
        "cat.investmentCapitalIncome.desc",
        "Rental income, dividends, interest, and capital gains.",
    ),
    preset(
        "cat.governmentSupplemental",
        "Government Benefits",
        INCOME,
        true,
        "cat.governmentSupplemental.desc",
        "Pension, Social Security, child support, alimony, and tax refunds.",
    ),
```

Finally, update the module doc comment's stale count near the top of the file: change "five income sources, nine expense categories" to "five income sources, eleven expense categories."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p budget-calc`
Expected: PASS, all tests in `budget-calc` green including the new/updated ones. (Every other existing structural test — `no_category_is_offered_twice`, `is_income_always_agrees_with_the_group_it_was_declared_under`, `every_preset_has_a_description`, etc. — covers the two new entries automatically; no changes needed there.)

Note: running `npm test` in `www/` at this point will show `i18n/presets.test.js` failing (`en`, `zh-Hans`, `zh-Hant` don't yet translate the two new keys). That's expected and gets fixed in Task 2 — it is not a regression to chase down now.

- [ ] **Step 5: Commit**

```bash
git add crates/budget-calc/src/presets.rs
git commit -m "$(cat <<'EOF'
Add Subscriptions & Gifts categories, plain-language renames

Research against YNAB/EveryDollar/Monarch/50-30-20 sources found
recurring-subscription and gifts/donations spend consistently
called out as missing, and three CPA-formal labels reading
unfamiliar next to how every comparable app phrases the same thing.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NbYus8gFyNhzJ11JRwedQE
EOF
)"
```

---

### Task 2: Translate the new/changed keys in all three i18n catalogs

**Files:**
- Modify: `www/src/i18n/en.js`
- Modify: `www/src/i18n/zh-Hans.js`
- Modify: `www/src/i18n/zh-Hant.js`

**Interfaces:**
- Consumes: the exact key strings from Task 1 (`cat.subscriptionsMemberships`, `cat.subscriptionsMemberships.desc`, `cat.giftsDonations`, `cat.giftsDonations.desc`, plus the existing `cat.investmentCapitalIncome`, `cat.debtServicing`, `cat.governmentSupplemental`, `cat.personalLifestyle.desc`, `budget.savingsHint`).

- [ ] **Step 1: Run the failing tests**

Run: `cd www && npx vitest run src/i18n/presets.test.js src/i18n/catalogs.test.js`
Expected: FAIL — `presets.test.js`'s `%s translates every preset key` case reports `cat.subscriptionsMemberships`/`cat.subscriptionsMemberships.desc`/`cat.giftsDonations`/`cat.giftsDonations.desc` missing from all three catalogs.

- [ ] **Step 2: Update `en.js`**

Change the three renamed entries and `cat.personalLifestyle.desc`:

```js
  'cat.investmentCapitalIncome': 'Investments',
  'cat.investmentCapitalIncome.desc': 'Rental income, dividends, interest, and capital gains.',
  'cat.governmentSupplemental': 'Government Benefits',
```

(descriptions for these two are unchanged, only the bare `name` line changes)

```js
  'cat.debtServicing': 'Debt Payments',
  'cat.debtServicing.desc':
    'Credit card balances, student loans, personal loans, medical debt payments.',
  'cat.personalLifestyle': 'Personal & Lifestyle',
  'cat.personalLifestyle.desc': 'Clothing/shoes, personal care, hobbies.',
```

Insert the new subscriptions entry right after `cat.personalLifestyle.desc`, and the new gifts entry right after `cat.familyDependents.desc` (matching `presets.rs`'s declaration order for readability — order within the catalog object has no functional effect, `catalogs.test.js` only checks key presence):

```js
  'cat.subscriptionsMemberships': 'Subscriptions & Memberships',
  'cat.subscriptionsMemberships.desc':
    'Streaming services, gym and other memberships, software subscriptions, recurring app fees.',
```

```js
  'cat.giftsDonations': 'Gifts & Donations',
  'cat.giftsDonations.desc': 'Birthday and holiday gifts, charitable donations, tithing.',
```

Update the Savings hint to point at Goals for anyone wanting a specific savings target:

```js
  'budget.savingsHint':
    "What's left after expenses. Set a specific savings target in Goals.",
```

- [ ] **Step 3: Update `zh-Hans.js`**

Mirror the same key changes with Simplified Chinese text:

```js
  'cat.investmentCapitalIncome': '投资',
  'cat.investmentCapitalIncome.desc': '租金收入、股息、利息和资本利得。',
  'cat.governmentSupplemental': '政府福利',
```

```js
  'cat.debtServicing': '偿还债务',
  'cat.debtServicing.desc': '信用卡欠款、学生贷款、个人贷款、医疗债务还款。',
  'cat.personalLifestyle': '个人与生活',
  'cat.personalLifestyle.desc': '服装鞋履、个人护理、爱好。',
```

```js
  'cat.subscriptionsMemberships': '订阅与会员',
  'cat.subscriptionsMemberships.desc': '流媒体服务、健身房及其他会员、软件订阅、常见应用内扣费。',
```

```js
  'cat.giftsDonations': '礼物与捐赠',
  'cat.giftsDonations.desc': '生日和节日礼物、慈善捐款、什一奉献。',
```

```js
  'budget.savingsHint': '收入减去所有支出后剩下的钱。想设定具体存款目标，请到"目标"页面。',
```

- [ ] **Step 4: Update `zh-Hant.js`**

Mirror the same key changes with Traditional Chinese text:

```js
  'cat.investmentCapitalIncome': '投資',
  'cat.investmentCapitalIncome.desc': '租金收入、股息、利息和資本利得。',
  'cat.governmentSupplemental': '政府福利',
```

```js
  'cat.debtServicing': '償還債務',
  'cat.debtServicing.desc': '信用卡欠款、學生貸款、個人貸款、醫療債務還款。',
  'cat.personalLifestyle': '個人與生活',
  'cat.personalLifestyle.desc': '服裝鞋類、個人護理、興趣愛好。',
```

```js
  'cat.subscriptionsMemberships': '訂閱與會籍',
  'cat.subscriptionsMemberships.desc': '訂閱服務、健身房及其他會籍、軟體訂閱、常見應用程式扣款。',
```

```js
  'cat.giftsDonations': '禮物與捐贈',
  'cat.giftsDonations.desc': '生日與節日禮物、慈善捐款、什一奉獻。',
```

```js
  'budget.savingsHint': '收入減去所有支出後剩下的錢。想設定具體存款目標，請到「目標」頁面。',
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd www && npx vitest run src/i18n/presets.test.js src/i18n/catalogs.test.js`
Expected: PASS — including `catalogs.test.js`'s encoding checks (`%s survived the file round-trip intact`, `%s actually contains Chinese`), which is why steps 3-4 must be written as real UTF-8 Chinese text, never pasted through anything that could mangle it.

- [ ] **Step 6: Commit**

```bash
git add www/src/i18n/en.js www/src/i18n/zh-Hans.js www/src/i18n/zh-Hant.js
git commit -m "$(cat <<'EOF'
Translate new/renamed category keys across all three catalogs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NbYus8gFyNhzJ11JRwedQE
EOF
)"
```

---

### Task 3: Give the two new presets a badge icon and a stable color slot

**Files:**
- Modify: `www/src/components/CategoryIcons.jsx`
- Modify: `www/src/categoryVisuals.js`
- Create: `www/src/categoryVisuals.test.js`
- Modify: `www/src/components/CategoryBadge.test.jsx`

**Interfaces:**
- Consumes: `cat.subscriptionsMemberships`, `cat.giftsDonations` (Task 1's keys).
- Produces: two new icon ids, `'repeat'` and `'gift'`, registered in `CATEGORY_ICONS`.

- [ ] **Step 1: Write the failing tests**

Create `www/src/categoryVisuals.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { CATEGORY_PALETTE, categoryColor, categoryIconId } from './categoryVisuals';

describe('categoryVisuals', () => {
  it('keeps every original 14 presets at their original color index', () => {
    // Locks the historical order in place -- categoryVisuals.js's own doc
    // comment says a preset's position here is its PERMANENT color slot
    // for every installation that already exists. This test exists so a
    // future edit that reorders PRESET_KEY_ORDER (e.g. to "tidy" it into
    // presets.rs's declaration order) fails loudly instead of silently
    // recoloring everyone's existing Housing/Utilities/etc. categories.
    const original14 = [
      'cat.primaryEarnedIncome',
      'cat.selfEmploymentBusiness',
      'cat.investmentCapitalIncome',
      'cat.governmentSupplemental',
      'cat.otherIncome',
      'cat.housing',
      'cat.utilities',
      'cat.foodGroceries',
      'cat.transportation',
      'cat.healthcareInsurance',
      'cat.debtServicing',
      'cat.personalLifestyle',
      'cat.familyDependents',
      'cat.otherExpenses',
    ];
    original14.forEach((key, index) => {
      const expectedColor = CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];
      expect(categoryColor({ preset_key: key })).toBe(expectedColor);
    });
  });

  it('gives the two new presets their own icon id', () => {
    expect(categoryIconId({ preset_key: 'cat.subscriptionsMemberships' })).toBe('repeat');
    expect(categoryIconId({ preset_key: 'cat.giftsDonations' })).toBe('gift');
  });

  it('gives the two new presets a color from the shared palette, not the hash fallback', () => {
    // A known preset_key always resolves through PRESET_KEY_ORDER, never
    // categoryColor's djb2-hash fallback (that path is only for a
    // hand-typed category with no preset_key at all).
    expect(CATEGORY_PALETTE).toContain(categoryColor({ preset_key: 'cat.subscriptionsMemberships' }));
    expect(CATEGORY_PALETTE).toContain(categoryColor({ preset_key: 'cat.giftsDonations' }));
  });
});
```

Add two cases to `www/src/components/CategoryBadge.test.jsx`, inside the existing `describe('CategoryBadge', ...)` block, alongside the housing/utilities cases:

```js
  it('renders the repeat icon for a category created from the subscriptions preset', () => {
    expect(categoryIconId({ preset_key: 'cat.subscriptionsMemberships' })).toBe('repeat');
  });

  it('renders the gift icon for a category created from the gifts preset', () => {
    expect(categoryIconId({ preset_key: 'cat.giftsDonations' })).toBe('gift');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd www && npx vitest run src/categoryVisuals.test.js src/components/CategoryBadge.test.jsx`
Expected: FAIL — `categoryIconId` returns the generic fallback (`'expense-generic'`) for both new preset keys since `PRESET_ICONS` doesn't know them yet, and `categoryColor` falls through to the hash-based fallback rather than the palette.

- [ ] **Step 3: Implement**

In `www/src/categoryVisuals.js`, append the two new keys to the **end** of `PRESET_KEY_ORDER` (do not touch the first 14 entries or their order):

```js
const PRESET_KEY_ORDER = [
  'cat.primaryEarnedIncome',
  'cat.selfEmploymentBusiness',
  'cat.investmentCapitalIncome',
  'cat.governmentSupplemental',
  'cat.otherIncome',
  'cat.housing',
  'cat.utilities',
  'cat.foodGroceries',
  'cat.transportation',
  'cat.healthcareInsurance',
  'cat.debtServicing',
  'cat.personalLifestyle',
  'cat.familyDependents',
  'cat.otherExpenses',
  'cat.subscriptionsMemberships',
  'cat.giftsDonations',
];
```

Add the two icon-id entries to `PRESET_ICONS`:

```js
const PRESET_ICONS = {
  'cat.primaryEarnedIncome': 'paycheck',
  'cat.selfEmploymentBusiness': 'briefcase',
  'cat.investmentCapitalIncome': 'trending-up',
  'cat.governmentSupplemental': 'building',
  'cat.otherIncome': 'coin',
  'cat.housing': 'house',
  'cat.utilities': 'bolt',
  'cat.foodGroceries': 'basket',
  'cat.transportation': 'car',
  'cat.healthcareInsurance': 'heart',
  'cat.debtServicing': 'card',
  'cat.personalLifestyle': 'sparkle',
  'cat.familyDependents': 'people',
  'cat.otherExpenses': 'tag',
  'cat.subscriptionsMemberships': 'repeat',
  'cat.giftsDonations': 'gift',
};
```

Also update the stale "14 starter presets" comment above `PRESET_KEY_ORDER` to say "16 starter presets."

In `www/src/components/CategoryIcons.jsx`, add two new icon components in the same hand-drawn, solid-shape style as the existing ones — insert them after `TagIcon` and before `IncomeGenericIcon`:

```jsx
export function RepeatIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M7 5.5h8a4 4 0 0 1 4 4V11h-2V9.5a2 2 0 0 0-2-2H7.8l1.6 1.6-1.4 1.4L4 6.5 8 2.5l1.4 1.4Z" />
      <path d="M17 18.5H9a4 4 0 0 1-4-4V13h2v1.5a2 2 0 0 0 2 2h8.2l-1.6-1.6 1.4-1.4L21 17.5 17 21.5l-1.4-1.4Z" />
    </svg>
  );
}

export function GiftIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path
        fillRule="evenodd"
        d="M4 10.5h16V13H4Zm1 3.5h14v6a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1ZM11 10.5h2V20h-2Z"
      />
      <path
        fillRule="evenodd"
        d="M9.3 4.2c1.7 0 2.7 2 3 3.6.3-1.6 1.3-3.6 3-3.6a2.1 2.1 0 0 1 0 4.2H6.7a2.1 2.1 0 0 1 0-4.2Zm.2 2a.6.6 0 1 0 0 1.2h1.6c-.2-.7-.8-1.2-1.6-1.2Zm5 0c-.8 0-1.4.5-1.6 1.2h1.6a.6.6 0 1 0 0-1.2Z"
      />
    </svg>
  );
}
```

Register both in `CATEGORY_ICONS`:

```jsx
export const CATEGORY_ICONS = {
  paycheck: PaycheckIcon,
  briefcase: BriefcaseIcon,
  'trending-up': TrendingUpIcon,
  building: BuildingIcon,
  coin: CoinIcon,
  house: HouseIcon,
  bolt: BoltIcon,
  basket: BasketIcon,
  car: CarIcon,
  heart: HeartIcon,
  card: CardIcon,
  sparkle: SparkleIcon,
  people: PeopleIcon,
  tag: TagIcon,
  repeat: RepeatIcon,
  gift: GiftIcon,
  'income-generic': IncomeGenericIcon,
  'expense-generic': ExpenseGenericIcon,
};
```

Also update the file's own doc comment ("14 starter-preset icons plus 2 generic fallbacks") to "16 starter-preset icons plus 2 generic fallbacks."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd www && npx vitest run src/categoryVisuals.test.js src/components/CategoryBadge.test.jsx`
Expected: PASS.

Then run the full frontend suite to confirm nothing else broke:

Run: `cd www && npm test`
Expected: PASS (this also re-confirms Task 2's i18n tests are still green with these changes layered on top).

- [ ] **Step 5: Commit**

```bash
git add www/src/components/CategoryIcons.jsx www/src/categoryVisuals.js www/src/categoryVisuals.test.js www/src/components/CategoryBadge.test.jsx
git commit -m "$(cat <<'EOF'
Add badge icon and stable color slot for the two new categories

New keys are appended to the end of PRESET_KEY_ORDER, never inserted
mid-list, so no existing installation's already-created categories
change color.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NbYus8gFyNhzJ11JRwedQE
EOF
)"
```

---

## Done when

- `cargo test -p budget-calc` is green.
- `cd www && npm test` is green.
- Opening the app fresh (or "Add common categories" on an empty budget) offers 16 categories: the original 12 unrenamed ones, three plain-language renames, and the two new ones, each with its own icon/color.
