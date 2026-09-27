//! Starter categories: one universal set.
//!
//! A first-run budget with no categories is a blank page, and the blank
//! page is where people give up -- naming a dozen categories from memory
//! is exactly the tedium a budgeting tool should absorb. These are the
//! lines most households actually have, offered as a starting point to
//! rename or delete, never imposed.
//!
//! The list is two levels deep: a top-level group (Housing & Utilities)
//! and its subcategories (Mortgage / Rent, Utilities, ...). It comes from
//! Mei, a CPA -- her list is the authoritative source for what belongs
//! where, down to the wording -- and replaced an earlier flat list of
//! sixteen (also hers) that had a one-line description per category
//! standing in for the detail the subcategories now carry. Budgets saved
//! under that older list are moved onto this one by
//! `category::migrate_legacy_categories`, driven by `LEGACY_PRESETS`.
//!
//! Before either of hers, an US/SG-specific pair lived here; the app's
//! region concept went with it, so nothing here takes a `Region`.
//!
//! **Why this lives in Rust rather than a JS constant.** Even a universal
//! taxonomy is a specific choice -- which eight expense groups, in what
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
    /// The preset this one is a subcategory of, by key -- `None` for one
    /// of the CPA's top-level groups. Only ever one level deep: a
    /// subcategory is never itself a parent (see
    /// `every_parent_is_a_top_level_preset`).
    pub parent_key: Option<&'static str>,
}

/// The group every income preset carries, as the same key-plus-English-
/// fallback pair the rest of this module uses. Public because a
/// hand-typed category has to land in the same two groups the presets do
/// -- see `category::resolve_category_name` -- and a second copy of these
/// literals is how the two drift into naming the same group differently.
pub const INCOME: (&str, &str) = ("cat.group.income", "Income");
/// The expense counterpart of [`INCOME`].
pub const EXPENSE: (&str, &str) = ("cat.group.expense", "Expense");

const fn top(key: &'static str, name: &'static str, is_income: bool) -> PresetCategory {
    let group = if is_income { INCOME } else { EXPENSE };
    PresetCategory {
        key,
        name,
        group_key: group.0,
        group: group.1,
        is_income,
        parent_key: None,
    }
}

const fn sub(parent: &PresetCategory, key: &'static str, name: &'static str) -> PresetCategory {
    PresetCategory {
        key,
        name,
        group_key: parent.group_key,
        group: parent.group,
        // Inherited, never restated: a subcategory on the other side of
        // the ledger from its parent would put its actual into a total
        // the parent's row never reads.
        is_income: parent.is_income,
        parent_key: Some(parent.key),
    }
}

const EARNED: PresetCategory = top("cat.earnedIncome", "Primary & Earned Income", true);
const PASSIVE: PresetCategory = top("cat.passiveIncome", "Passive & Investment Income", true);
const OTHER_INCOME: PresetCategory = top("cat.miscIncome", "Other Income", true);

const HOUSING: PresetCategory = top("cat.housingUtilities", "Housing & Utilities", false);
const TRANSPORT: PresetCategory = top("cat.transport", "Transportation", false);
const FOOD: PresetCategory = top("cat.foodBasics", "Food & Basic Goods", false);
const HEALTH: PresetCategory = top("cat.healthInsurance", "Health & Insurance", false);
const OBLIGATIONS: PresetCategory = top("cat.obligationsSupport", "Obligations & Support", false);
const DINING: PresetCategory = top("cat.diningSocial", "Dining & Social", false);
const ENTERTAINMENT: PresetCategory =
    top("cat.entertainmentLeisure", "Entertainment & Leisure", false);
const LIFESTYLE: PresetCategory = top("cat.lifestyleShopping", "Lifestyle & Shopping", false);

/// The CPA's list, top-level group first and its subcategories straight
/// after it, in her order. Replaced the earlier flat sixteen (five income
/// sources, eleven expense buckets) on 2026-09-27; the keys are all new
/// rather than reused, so `LEGACY_PRESETS` below can tell a category
/// saved from the old list apart from one saved from this one.
const CATALOGUE: &[PresetCategory] = &[
    EARNED,
    sub(&EARNED, "cat.salaryWages", "Salary / Wages"),
    sub(&EARNED, "cat.bonusesTips", "Bonuses & Tips"),
    sub(&EARNED, "cat.freelanceSideGig", "Freelance / Side Gig"),
    PASSIVE,
    sub(&PASSIVE, "cat.dividendsInterest", "Dividends & Interest"),
    sub(&PASSIVE, "cat.rentalIncome", "Rental Income"),
    sub(&PASSIVE, "cat.capitalGains", "Capital Gains"),
    OTHER_INCOME,
    sub(&OTHER_INCOME, "cat.taxRefunds", "Tax Refunds"),
    sub(
        &OTHER_INCOME,
        "cat.giftsReimbursements",
        "Gifts & Reimbursements",
    ),
    sub(
        &OTHER_INCOME,
        "cat.governmentBenefits",
        "Government Benefits",
    ),
    HOUSING,
    sub(&HOUSING, "cat.mortgageRent", "Mortgage / Rent"),
    sub(&HOUSING, "cat.propertyTaxes", "Property Taxes"),
    sub(&HOUSING, "cat.hoa", "HOA"),
    sub(&HOUSING, "cat.utilityBills", "Utilities"),
    sub(&HOUSING, "cat.homeMaintenance", "Home Maintenance"),
    TRANSPORT,
    sub(&TRANSPORT, "cat.autoLoanLease", "Auto Loan / Lease"),
    sub(&TRANSPORT, "cat.fuelCharging", "Fuel / Charging"),
    sub(
        &TRANSPORT,
        "cat.transitRideshare",
        "Public Transit & Rideshare",
    ),
    sub(&TRANSPORT, "cat.vehicleMaintenance", "Vehicle Maintenance"),
    FOOD,
    sub(&FOOD, "cat.groceries", "Groceries"),
    sub(
        &FOOD,
        "cat.personalCareEssentials",
        "Personal Care Essentials",
    ),
    HEALTH,
    sub(&HEALTH, "cat.insurancePremiums", "Insurance Premiums"),
    sub(&HEALTH, "cat.medicalOutOfPocket", "Medical Out-of-Pocket"),
    OBLIGATIONS,
    sub(&OBLIGATIONS, "cat.debtPayments", "Debt Payments"),
    sub(&OBLIGATIONS, "cat.dependentCare", "Dependent Care"),
    sub(
        &OBLIGATIONS,
        "cat.alimonyChildSupport",
        "Alimony / Child Support",
    ),
    DINING,
    sub(&DINING, "cat.restaurantsCafes", "Restaurants & Cafes"),
    sub(&DINING, "cat.foodDelivery", "Food Delivery"),
    ENTERTAINMENT,
    sub(
        &ENTERTAINMENT,
        "cat.subscriptionsStreaming",
        "Subscriptions & Streaming",
    ),
    sub(
        &ENTERTAINMENT,
        "cat.hobbiesRecreation",
        "Hobbies & Recreation",
    ),
    sub(&ENTERTAINMENT, "cat.vacationTravel", "Vacation & Travel"),
    LIFESTYLE,
    sub(
        &LIFESTYLE,
        "cat.apparelAccessories",
        "Apparel & Accessories",
    ),
    sub(&LIFESTYLE, "cat.electronicsTech", "Electronics & Tech"),
    sub(&LIFESTYLE, "cat.personalUpkeep", "Personal Upkeep"),
    sub(&LIFESTYLE, "cat.giftsGiving", "Gifts & Donations"),
];

/// Every starter category, top-level groups and subcategories both, each
/// group immediately followed by its own subcategories.
pub fn starter_categories() -> Vec<PresetCategory> {
    CATALOGUE.to_vec()
}

/// The preset a key names, if it is one of today's.
pub fn preset_by_key(key: &str) -> Option<PresetCategory> {
    CATALOGUE.iter().find(|p| p.key == key).copied()
}

/// The top-level groups a genuinely fresh budget (or one just cleared back
/// to nothing) is auto-seeded with, in place of all eleven.
///
/// Onboarding research on this app (a real product-review pass, not a
/// hunch) found the full category table read as machinery before anyone
/// had typed a dollar figure. Five groups -- one income source, four of
/// the expenses nearly every household actually has -- gets someone to a
/// usable first plan in one screen; the Budget tab plans at this level, so
/// five rows is still five rows even though each arrives with its
/// subcategories. `CategoryChipPicker` still offers the other six.
///
/// Dining & Social rather than Health & Insurance for the fourth: the old
/// compact set's Food & Groceries covered eating out, and that now lives
/// in its own group -- leaving it out would take something a fresh budget
/// used to have away.
const COMPACT_STARTER_KEYS: &[&str] = &[
    "cat.earnedIncome",
    "cat.housingUtilities",
    "cat.foodBasics",
    "cat.diningSocial",
    "cat.transport",
];

/// The compact starter set: each of `COMPACT_STARTER_KEYS`'s groups, in
/// that order, followed by its own subcategories -- filtered from
/// `starter_categories()` rather than declared separately, so the two can
/// never drift into naming the same category two different ways.
pub fn compact_starter_categories() -> Vec<PresetCategory> {
    COMPACT_STARTER_KEYS
        .iter()
        .flat_map(|key| {
            let parent = preset_by_key(key)
                .unwrap_or_else(|| panic!("{key} is not a starter_categories() preset"));
            std::iter::once(parent).chain(
                CATALOGUE
                    .iter()
                    .filter(move |p| p.parent_key == Some(parent.key))
                    .copied(),
            )
        })
        .collect()
}

/// Where a category saved from the pre-2026-09-27 flat list lands in the
/// CPA's list: the new preset it becomes, or `None` for the one old
/// category ("Other Expenses") the new list deliberately has no bucket
/// for. `category::migrate_legacy_categories` is what applies it.
///
/// Each group's catch-all subcategory: where a group's own planned amount
/// goes when an old budget had planned both the group and something under
/// it (see `category::settle_split_plans`). "Housing" on the old list was
/// the rent line, so Housing & Utilities' own amount is Mortgage / Rent's.
pub const PRIMARY_SUBCATEGORY: &[(&str, &str)] = &[
    ("cat.earnedIncome", "cat.salaryWages"),
    ("cat.passiveIncome", "cat.dividendsInterest"),
    ("cat.miscIncome", "cat.giftsReimbursements"),
    ("cat.housingUtilities", "cat.mortgageRent"),
    ("cat.transport", "cat.fuelCharging"),
    ("cat.foodBasics", "cat.groceries"),
    ("cat.healthInsurance", "cat.insurancePremiums"),
    ("cat.obligationsSupport", "cat.debtPayments"),
    ("cat.diningSocial", "cat.restaurantsCafes"),
    ("cat.entertainmentLeisure", "cat.hobbiesRecreation"),
    ("cat.lifestyleShopping", "cat.personalUpkeep"),
];

/// Each old key maps to exactly one new one, and the category keeps its
/// id when it moves -- which is what keeps every transaction, plan and
/// rule that points at it pointing at the right thing afterwards. Where
/// two old categories now share a group (Housing and Utilities), the one
/// that matches the group becomes it and the other becomes one of its
/// subcategories, rather than merging two ids into one.
pub const LEGACY_PRESETS: &[(&str, Option<&str>)] = &[
    ("cat.primaryEarnedIncome", Some("cat.earnedIncome")),
    ("cat.selfEmploymentBusiness", Some("cat.freelanceSideGig")),
    ("cat.investmentCapitalIncome", Some("cat.passiveIncome")),
    ("cat.governmentSupplemental", Some("cat.governmentBenefits")),
    ("cat.otherIncome", Some("cat.miscIncome")),
    ("cat.housing", Some("cat.housingUtilities")),
    ("cat.utilities", Some("cat.utilityBills")),
    ("cat.foodGroceries", Some("cat.foodBasics")),
    ("cat.transportation", Some("cat.transport")),
    ("cat.healthcareInsurance", Some("cat.healthInsurance")),
    ("cat.debtServicing", Some("cat.debtPayments")),
    ("cat.personalLifestyle", Some("cat.lifestyleShopping")),
    (
        "cat.subscriptionsMemberships",
        Some("cat.subscriptionsStreaming"),
    ),
    ("cat.familyDependents", Some("cat.dependentCare")),
    ("cat.giftsDonations", Some("cat.giftsGiving")),
    ("cat.otherExpenses", None),
];

#[cfg(test)]
mod tests {

    #[test]
    fn every_group_names_one_of_its_own_subcategories_as_primary() {
        for group in starter_categories()
            .iter()
            .filter(|p| p.parent_key.is_none())
        {
            let (_, sub) = PRIMARY_SUBCATEGORY
                .iter()
                .find(|(g, _)| *g == group.key)
                .unwrap_or_else(|| panic!("{} has no primary subcategory", group.key));
            let sub = preset_by_key(sub).expect("primary is a real preset");
            assert_eq!(
                sub.parent_key,
                Some(group.key),
                "{} is not under {}",
                sub.key,
                group.key
            );
        }
    }
    use super::*;
    use crate::Category;

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
        // A subcategory's name shows on its own in the transaction list
        // and the picker's search, so two sharing one -- even under
        // different parents -- would be indistinguishable there, and
        // would collide in `availablePresets`'s name-based dedup.
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
                Category::new("id", p.name, p.group, p.is_income, "").is_ok(),
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
    fn the_cpa_list_has_three_income_and_eight_expense_groups() {
        let presets = starter_categories();
        let tops = |income: bool| {
            presets
                .iter()
                .filter(|p| p.parent_key.is_none() && p.is_income == income)
                .count()
        };
        assert_eq!(tops(true), 3);
        assert_eq!(tops(false), 8);
        assert_eq!(
            presets.len(),
            3 + 8 + 9 + 25,
            "9 income and 25 expense subcategories"
        );
    }

    #[test]
    fn every_parent_is_a_top_level_preset() {
        for p in starter_categories() {
            if let Some(parent_key) = p.parent_key {
                let parent = preset_by_key(parent_key)
                    .unwrap_or_else(|| panic!("{} names a missing parent", p.key));
                assert!(parent.parent_key.is_none(), "{} is nested twice", p.key);
                assert_eq!(parent.is_income, p.is_income, "{} changes side", p.key);
            }
        }
    }

    #[test]
    fn every_group_has_subcategories_listed_straight_after_it() {
        // The Categories screen and the picker both render in catalogue
        // order, so a subcategory declared away from its parent would
        // still group correctly -- but this order is also what "add the
        // whole group" inserts, and reads as the CPA wrote it.
        let presets = starter_categories();
        let mut current_parent = None;
        for p in &presets {
            match p.parent_key {
                None => current_parent = Some(p.key),
                Some(parent) => assert_eq!(Some(parent), current_parent, "{} is misplaced", p.key),
            }
        }
        for top in presets.iter().filter(|p| p.parent_key.is_none()) {
            assert!(
                presets.iter().any(|p| p.parent_key == Some(top.key)),
                "{} has no subcategories",
                top.key
            );
        }
    }

    #[test]
    fn is_income_always_agrees_with_the_group() {
        for p in starter_categories() {
            assert_eq!(p.is_income, p.group == "Income", "{}", p.key);
        }
    }

    #[test]
    fn compact_starter_set_is_one_income_and_four_expense_groups_with_their_subcategories() {
        let compact = compact_starter_categories();
        let tops: Vec<_> = compact.iter().filter(|p| p.parent_key.is_none()).collect();
        assert_eq!(tops.len(), 5);
        assert_eq!(tops.iter().filter(|p| p.is_income).count(), 1);
        let top_keys: Vec<_> = tops.iter().map(|p| p.key).collect();
        assert_eq!(top_keys, COMPACT_STARTER_KEYS);
        for p in &compact {
            if let Some(parent) = p.parent_key {
                assert!(
                    top_keys.contains(&parent),
                    "{} arrives without its group",
                    p.key
                );
            }
        }
        let full = starter_categories();
        for top in &tops {
            let subs = |list: &[PresetCategory]| {
                list.iter()
                    .filter(|p| p.parent_key == Some(top.key))
                    .count()
            };
            assert_eq!(
                subs(&compact),
                subs(&full),
                "{} is missing subcategories",
                top.key
            );
        }
    }

    #[test]
    fn every_legacy_key_lands_on_a_real_preset_and_none_is_reused() {
        let mut seen = Vec::new();
        for (old, new) in LEGACY_PRESETS {
            assert!(preset_by_key(old).is_none(), "{old} is still a live key");
            if let Some(new) = new {
                assert!(preset_by_key(new).is_some(), "{old} maps to missing {new}");
                assert!(!seen.contains(new), "two old categories land on {new}");
                seen.push(*new);
            }
        }
        assert_eq!(LEGACY_PRESETS.len(), 16, "the old list had sixteen");
    }
}
