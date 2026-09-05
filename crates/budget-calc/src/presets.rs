//! Starter categories: one universal set.
//!
//! A first-run budget with no categories is a blank page, and the blank
//! page is where people give up -- naming a dozen categories from memory
//! is exactly the tedium a budgeting tool should absorb. These are the
//! lines most households actually have, offered as a starting point to
//! rename or delete, never imposed.
//!
//! This list replaced an earlier US/SG-specific pair after real-user
//! feedback: the income/expense taxonomy below (five income sources,
//! eleven expense categories, an "Other" catch-all on each side) isn't
//! region-flavoured the way the old set was (S&CC, a parents' allowance).
//! The app's region/market concept was removed outright afterwards --
//! nothing else in this codebase needed it either, so there was no reason
//! left to carry a `Region` parameter through here just for this.
//!
//! Both the taxonomy and each category's `description` come from Mei, a
//! CPA -- her list is the authoritative source for what belongs where,
//! down to the wording. Descriptions carry through to `Category` and stay
//! visible as a standing hint (not just shown once at seed time), so
//! "does this receipt go under Personal & Lifestyle or Family &
//! Dependents" has an answer on-screen instead of relying on memory.
//!
//! **Why this lives in Rust rather than a JS constant.** Even a universal
//! taxonomy is a specific choice -- which eleven expense buckets, in what
//! words -- that a second implementation could make differently. See
//! CLAUDE.md's "choosing between rulesets" rule.
//!
//! **Why a key and not a name.** Same convention as `budget-wasm`'s
//! `Message`: what crosses the boundary is a code plus an English
//! fallback, never pre-composed prose. The UI composes the actual stored
//! name in the reader's language, so a Chinese user's budget opens with
//! Chinese category names rather than English ones they have to retype.

/// One suggested category: an i18n key for the UI to translate, plus the
/// English text to fall back on if that key is ever missing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PresetCategory {
    pub key: &'static str,
    pub name: &'static str,
    pub group_key: &'static str,
    pub group: &'static str,
    pub is_income: bool,
    /// i18n key for `description`, following the same key-plus-fallback
    /// convention as `key`/`name` above.
    pub description_key: &'static str,
    /// What belongs in this category, in a CPA's own words -- the list
    /// this whole module is sourced from (see the module doc). Shown as
    /// a standing hint under the category, not just at seed time, so it
    /// keeps earning its keep the next time someone can't remember which
    /// bucket a receipt goes in.
    pub description: &'static str,
}

const INCOME: (&str, &str) = ("cat.group.income", "Income");
const EXPENSE: (&str, &str) = ("cat.group.expense", "Expense");

#[allow(clippy::too_many_arguments)]
const fn preset(
    key: &'static str,
    name: &'static str,
    group: (&'static str, &'static str),
    is_income: bool,
    description_key: &'static str,
    description: &'static str,
) -> PresetCategory {
    PresetCategory {
        key,
        name,
        group_key: group.0,
        group: group.1,
        is_income,
        description_key,
        description,
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
        "cat.primaryEarnedIncome.desc",
        "Salary, wages, overtime pay, tips, and bonuses.",
    ),
    preset(
        "cat.selfEmploymentBusiness",
        "Self-Employment & Business",
        INCOME,
        true,
        "cat.selfEmploymentBusiness.desc",
        "Freelance revenue, gig work, consulting fees, and business profits.",
    ),
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
    preset(
        "cat.otherIncome",
        "Other Income",
        INCOME,
        true,
        "cat.otherIncome.desc",
        "Any other income that doesn't fit the categories above.",
    ),
];

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

/// The starter categories to offer a first-time budget.
pub fn starter_categories() -> Vec<PresetCategory> {
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

    #[test]
    fn offers_a_usable_starter_set() {
        let presets = starter_categories();
        assert!(
            presets.len() >= 8,
            "offers only {} categories -- too few to save anyone the typing",
            presets.len()
        );
    }

    #[test]
    fn no_category_is_offered_twice() {
        let mut keys: Vec<_> = starter_categories().iter().map(|p| p.key).collect();
        let before = keys.len();
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(before, keys.len(), "repeats a category key");
    }

    #[test]
    fn no_two_categories_share_a_display_name() {
        // The category picker is a flat list with no group headers, so a
        // repeated name (the literal "Others" in the original feedback)
        // would be indistinguishable there, and would collide in
        // `addCommonCategories`'s name-based dedup.
        let mut names: Vec<_> = starter_categories().iter().map(|p| p.name).collect();
        let before = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(before, names.len(), "repeats a category name");
    }

    #[test]
    fn every_preset_is_a_valid_category() {
        // The English fallback has to survive the same validation a
        // hand-typed name does, or a preset could insert a record that
        // Category::new would have rejected.
        for p in starter_categories() {
            assert!(
                Category::new("id", p.name, p.group, p.is_income, p.description).is_ok(),
                "{} is not a valid category name",
                p.name
            );
            assert!(!p.key.is_empty() && !p.group_key.is_empty());
        }
    }

    #[test]
    fn every_preset_key_is_namespaced_for_the_catalogs() {
        // The frontend test that pairs these against en.js keys off this
        // prefix; a preset that skipped it would silently go untranslated.
        for p in starter_categories() {
            assert!(p.key.starts_with("cat."), "{} is not namespaced", p.key);
            assert!(p.group_key.starts_with("cat.group."));
        }
    }

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
        assert_eq!(
            by_key("cat.governmentSupplemental").name,
            "Government Benefits"
        );
    }

    #[test]
    fn is_income_always_agrees_with_the_group_it_was_declared_under() {
        // The two are set independently at each `preset(...)` call site --
        // this catches a copy-paste that flipped one without the other.
        for p in starter_categories() {
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

    #[test]
    fn every_preset_has_a_description() {
        // Mei's list is the point of this module -- a preset that lost
        // its description on the way in would silently fall back to
        // showing nothing, same failure mode a missing translation has.
        for p in starter_categories() {
            assert!(!p.description.is_empty(), "{} has no description", p.name);
            assert!(
                p.description_key.starts_with("cat.") && p.description_key.ends_with(".desc"),
                "{} is not namespaced",
                p.description_key
            );
        }
    }

    #[test]
    fn no_description_key_is_offered_twice() {
        let mut keys: Vec<_> = starter_categories()
            .iter()
            .map(|p| p.description_key)
            .collect();
        let before = keys.len();
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(before, keys.len(), "a description key repeats");
    }
}
