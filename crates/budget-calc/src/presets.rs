//! Starter categories: one universal set, not a per-region one.
//!
//! A first-run budget with no categories is a blank page, and the blank
//! page is where people give up -- naming a dozen categories from memory
//! is exactly the tedium a budgeting tool should absorb. These are the
//! lines most households actually have, offered as a starting point to
//! rename or delete, never imposed.
//!
//! This list replaced an earlier US/SG-specific pair after real-user
//! feedback: the income/expense taxonomy below (five income sources,
//! nine expense categories, an "Other" catch-all on each side) isn't
//! region-flavoured the way the old set was (S&CC, a parents' allowance),
//! so `for_region` now hands back the same set regardless of region --
//! kept as a function, not simplified to a constant, so a genuinely
//! region-specific line item has somewhere to go later without another
//! signature change rippling through `budget-wasm` and `www/`.
//!
//! **Why this lives in Rust rather than a JS constant.** Even a universal
//! taxonomy is a specific choice -- which nine expense buckets, in what
//! words -- that a second implementation could make differently. See
//! CLAUDE.md's "choosing between rulesets" rule.
//!
//! **Why a key and not a name.** Same convention as `budget-wasm`'s
//! `Message`: what crosses the boundary is a code plus an English
//! fallback, never pre-composed prose. The UI composes the actual stored
//! name in the reader's language, so a Chinese user's budget opens with
//! Chinese category names rather than English ones they have to retype.

use budget_core::Region;

/// One suggested category: an i18n key for the UI to translate, plus the
/// English text to fall back on if that key is ever missing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PresetCategory {
    pub key: &'static str,
    pub name: &'static str,
    pub group_key: &'static str,
    pub group: &'static str,
    pub is_income: bool,
}

const INCOME: (&str, &str) = ("cat.group.income", "Income");
const EXPENSE: (&str, &str) = ("cat.group.expense", "Expense");

const fn preset(
    key: &'static str,
    name: &'static str,
    group: (&'static str, &'static str),
    is_income: bool,
) -> PresetCategory {
    PresetCategory {
        key,
        name,
        group_key: group.0,
        group: group.1,
        is_income,
    }
}

/// Five ways a household's money tends to come in, from a paycheck
/// through to a tax refund. Named "Other Income" rather than the bare
/// "Others" of the original feedback -- this app's category list is
/// flat (no group headers in the picker itself), and two categories both
/// literally named "Others" would be indistinguishable there, and would
/// collide in the auto-seed step besides (`addCommonCategories` dedupes
/// by name).
const INCOME_CATEGORIES: &[PresetCategory] = &[
    preset(
        "cat.primaryEarnedIncome",
        "Primary Earned Income",
        INCOME,
        true,
    ),
    preset(
        "cat.selfEmploymentBusiness",
        "Self-Employment & Business",
        INCOME,
        true,
    ),
    preset(
        "cat.investmentCapitalIncome",
        "Investment & Capital Income",
        INCOME,
        true,
    ),
    preset(
        "cat.governmentSupplemental",
        "Government & Supplemental",
        INCOME,
        true,
    ),
    preset("cat.otherIncome", "Other Income", INCOME, true),
];

const EXPENSE_CATEGORIES: &[PresetCategory] = &[
    preset("cat.housing", "Housing", EXPENSE, false),
    preset("cat.utilities", "Utilities", EXPENSE, false),
    preset("cat.foodGroceries", "Food & Groceries", EXPENSE, false),
    preset("cat.transportation", "Transportation", EXPENSE, false),
    preset(
        "cat.healthcareInsurance",
        "Healthcare & Insurance",
        EXPENSE,
        false,
    ),
    preset("cat.debtServicing", "Debt Servicing", EXPENSE, false),
    preset(
        "cat.personalLifestyle",
        "Personal & Lifestyle",
        EXPENSE,
        false,
    ),
    preset(
        "cat.familyDependents",
        "Family & Dependents",
        EXPENSE,
        false,
    ),
    preset("cat.otherExpenses", "Other Expenses", EXPENSE, false),
];

/// The starter categories to offer a first-time budget. `region` is
/// unused today -- see the module doc for why the parameter stays.
pub fn for_region(_region: Region) -> Vec<PresetCategory> {
    INCOME_CATEGORIES
        .iter()
        .chain(EXPENSE_CATEGORIES)
        .copied()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Category;

    const EVERY_REGION: [Region; 2] = [Region::Us, Region::Sg];

    #[test]
    fn every_region_gets_a_usable_starter_set() {
        for region in EVERY_REGION {
            let presets = for_region(region);
            assert!(
                presets.len() >= 8,
                "{region:?} offers only {} categories -- too few to save anyone the typing",
                presets.len()
            );
        }
    }

    #[test]
    fn no_category_is_offered_twice() {
        for region in EVERY_REGION {
            let mut keys: Vec<_> = for_region(region).iter().map(|p| p.key).collect();
            let before = keys.len();
            keys.sort_unstable();
            keys.dedup();
            assert_eq!(before, keys.len(), "{region:?} repeats a category key");
        }
    }

    #[test]
    fn no_two_categories_share_a_display_name() {
        // The category picker is a flat list with no group headers, so a
        // repeated name (the literal "Others" in the original feedback)
        // would be indistinguishable there, and would collide in
        // `addCommonCategories`'s name-based dedup.
        for region in EVERY_REGION {
            let mut names: Vec<_> = for_region(region).iter().map(|p| p.name).collect();
            let before = names.len();
            names.sort_unstable();
            names.dedup();
            assert_eq!(before, names.len(), "{region:?} repeats a category name");
        }
    }

    #[test]
    fn every_preset_is_a_valid_category() {
        // The English fallback has to survive the same validation a
        // hand-typed name does, or a preset could insert a record that
        // Category::new would have rejected.
        for region in EVERY_REGION {
            for p in for_region(region) {
                assert!(
                    Category::new("id", p.name, p.group, p.is_income).is_ok(),
                    "{} is not a valid category name",
                    p.name
                );
                assert!(!p.key.is_empty() && !p.group_key.is_empty());
            }
        }
    }

    #[test]
    fn every_preset_key_is_namespaced_for_the_catalogs() {
        // The frontend test that pairs these against en.js keys off this
        // prefix; a preset that skipped it would silently go untranslated.
        for region in EVERY_REGION {
            for p in for_region(region) {
                assert!(p.key.starts_with("cat."), "{} is not namespaced", p.key);
                assert!(p.group_key.starts_with("cat.group."));
            }
        }
    }

    #[test]
    fn both_regions_currently_return_the_same_universal_set() {
        // Documents the current reality (see the module doc) rather than
        // asserting it can never change -- if a genuinely region-specific
        // line item is added later, update this test to say so, don't
        // just delete it.
        assert_eq!(for_region(Region::Us), for_region(Region::Sg));
    }

    #[test]
    fn five_income_categories_and_nine_expense_categories() {
        let presets = for_region(Region::Us);
        let income = presets.iter().filter(|p| p.group == "Income").count();
        let expense = presets.iter().filter(|p| p.group == "Expense").count();
        assert_eq!(income, 5);
        assert_eq!(expense, 9);
    }

    #[test]
    fn is_income_always_agrees_with_the_group_it_was_declared_under() {
        // The two are set independently at each `preset(...)` call site --
        // this catches a copy-paste that flipped one without the other.
        for p in for_region(Region::Us) {
            assert_eq!(
                p.is_income,
                p.group == "Income",
                "{} has is_income={} but group={:?}",
                p.name,
                p.is_income,
                p.group
            );
        }
    }
}
