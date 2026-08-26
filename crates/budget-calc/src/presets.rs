//! Starter category sets, per region.
//!
//! A first-run budget with no categories is a blank page, and the blank
//! page is where people give up -- naming a dozen categories from memory
//! is exactly the tedium a budgeting tool should absorb. These are the
//! lines most households actually have, offered as a starting point to
//! rename or delete, never imposed.
//!
//! **Why this lives in Rust rather than a JS constant.** Which categories
//! a market gets is domain content that differs by ruleset: an SG budget
//! has S&CC and a parents' allowance where a US one has health insurance
//! premiums. That is "choosing between rulesets" in CLAUDE.md's sense --
//! a second implementation could give a different answer -- so it is
//! tested here rather than drifting in a `.jsx` file.
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
}

const HOME: (&str, &str) = ("cat.group.home", "Home");
const FOOD: (&str, &str) = ("cat.group.food", "Food");
const TRANSPORT: (&str, &str) = ("cat.group.transport", "Transport");
const HEALTH: (&str, &str) = ("cat.group.health", "Health");
const FAMILY: (&str, &str) = ("cat.group.family", "Family");
const PERSONAL: (&str, &str) = ("cat.group.personal", "Personal");
const MONEY: (&str, &str) = ("cat.group.money", "Money");

const fn preset(
    key: &'static str,
    name: &'static str,
    group: (&'static str, &'static str),
) -> PresetCategory {
    PresetCategory {
        key,
        name,
        group_key: group.0,
        group: group.1,
    }
}

const US: &[PresetCategory] = &[
    preset("cat.rentOrMortgage", "Rent or mortgage", HOME),
    preset("cat.utilities", "Utilities", HOME),
    preset("cat.internetPhone", "Internet & phone", HOME),
    preset("cat.groceries", "Groceries", FOOD),
    preset("cat.eatingOut", "Eating out", FOOD),
    preset("cat.carFuel", "Car & fuel", TRANSPORT),
    preset("cat.publicTransport", "Public transport", TRANSPORT),
    preset("cat.healthInsurance", "Health insurance", HEALTH),
    preset("cat.medicalPharmacy", "Medical & pharmacy", HEALTH),
    preset("cat.subscriptions", "Subscriptions", PERSONAL),
    preset("cat.funLeisure", "Fun & leisure", PERSONAL),
    preset("cat.savings", "Savings", MONEY),
    preset("cat.debtPayments", "Debt payments", MONEY),
];

/// Singapore's set differs in four places, all of them real rather than
/// cosmetic: utilities are billed alongside S&CC, a household is far more
/// likely to budget public transport and ride-hailing than a car, health
/// cover is an integrated-shield-style policy rather than a US-style
/// premium, and a monthly allowance to parents is a mainstream budget
/// line here in a way it is not in the US set.
const SG: &[PresetCategory] = &[
    preset("cat.rentOrMortgage", "Rent or mortgage", HOME),
    preset("cat.utilitiesScc", "Utilities & S&CC", HOME),
    preset("cat.internetMobile", "Internet & mobile", HOME),
    preset("cat.groceries", "Groceries", FOOD),
    preset("cat.hawkerEatingOut", "Hawker & eating out", FOOD),
    preset(
        "cat.publicTransportGrab",
        "Public transport & Grab",
        TRANSPORT,
    ),
    preset("cat.carFuel", "Car & fuel", TRANSPORT),
    preset("cat.insurance", "Insurance", HEALTH),
    preset("cat.medicalDental", "Medical & dental", HEALTH),
    preset("cat.parentsAllowance", "Parents' allowance", FAMILY),
    preset("cat.subscriptions", "Subscriptions", PERSONAL),
    preset("cat.funLeisure", "Fun & leisure", PERSONAL),
    preset("cat.savings", "Savings", MONEY),
    preset("cat.debtPayments", "Debt payments", MONEY),
];

/// The starter categories to offer a first-time budget in `region`.
pub fn for_region(region: Region) -> &'static [PresetCategory] {
    match region {
        Region::Us => US,
        Region::Sg => SG,
    }
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
    fn no_region_offers_the_same_category_twice() {
        for region in EVERY_REGION {
            let mut keys: Vec<_> = for_region(region).iter().map(|p| p.key).collect();
            let before = keys.len();
            keys.sort_unstable();
            keys.dedup();
            assert_eq!(before, keys.len(), "{region:?} repeats a category key");
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
                    Category::new("id", p.name, p.group).is_ok(),
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
    fn singapore_is_not_just_a_copy_of_the_us_set() {
        let us: Vec<_> = for_region(Region::Us).iter().map(|p| p.key).collect();
        let sg: Vec<_> = for_region(Region::Sg).iter().map(|p| p.key).collect();
        assert_ne!(us, sg);
        assert!(sg.contains(&"cat.parentsAllowance"));
        assert!(!us.contains(&"cat.parentsAllowance"));
    }

    #[test]
    fn both_regions_share_the_categories_that_are_genuinely_universal() {
        for key in ["cat.rentOrMortgage", "cat.groceries", "cat.savings"] {
            for region in EVERY_REGION {
                assert!(
                    for_region(region).iter().any(|p| p.key == key),
                    "{region:?} is missing {key}"
                );
            }
        }
    }
}
