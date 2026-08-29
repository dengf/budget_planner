//! Categories and the zero-based monthly budget.
//!
//! "Zero-based" means every category gets a planned amount and the sum is
//! meant to account for the whole month's income -- not that spending is
//! capped to zero. A category that goes over doesn't error; it produces a
//! negative `remaining`, which the UI reframes as "borrowed from next
//! month" rather than a failure (see budget-wasm's Message layer).

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use budget_core::{round_currency, BudgetError, BudgetResult};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Category {
    pub id: String,
    pub name: String,
    /// Free-form, used for the printable report's grouping and the
    /// starter presets (`presets::starter_categories`) -- never matched on
    /// for behaviour, only for display order.
    pub group: String,
    /// Which side of the ledger this category belongs to. Unlike `group`,
    /// this one *is* matched on for behaviour: it's how the frontend
    /// decides whether a category's "actual" comes from
    /// `transaction::spend_by_category` or `transaction::income_by_category`
    /// -- `build_month` itself stays ignorant of it, same as `group`, since
    /// it only ever sees a category id paired with a plain amount.
    #[serde(default)]
    pub is_income: bool,
    /// Free-form guidance on what belongs in this category -- populated
    /// from `presets::starter_categories` on a starter category, blank on
    /// a hand-typed one. `#[serde(default)]` so a category saved before
    /// this field existed still loads.
    #[serde(default)]
    pub description: String,
}

impl Category {
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        group: impl Into<String>,
        is_income: bool,
        description: impl Into<String>,
    ) -> BudgetResult<Self> {
        let name = name.into();
        if name.trim().is_empty() {
            return Err(BudgetError::BlankCategoryName);
        }
        Ok(Self {
            id: id.into(),
            name,
            group: group.into(),
            description: description.into(),
            is_income,
        })
    }
}

/// One category's plan for one month: what was allocated, what carried in
/// from the previous month's rollover, and what's left once actual
/// spending is applied.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CategoryLine {
    pub category_id: String,
    pub planned: Decimal,
    /// Positive if last month's remaining balance carried forward
    /// (underspend), negative if last month's overspend is being repaid
    /// out of this month's plan.
    pub rollover: Decimal,
    pub spent: Decimal,
    pub remaining: Decimal,
}

fn build_line(
    category_id: String,
    planned: Decimal,
    rollover: Decimal,
    spent: Decimal,
) -> CategoryLine {
    let remaining = round_currency(planned + rollover - spent);
    CategoryLine {
        category_id,
        planned: round_currency(planned),
        rollover: round_currency(rollover),
        spent: round_currency(spent),
        remaining,
    }
}

/// A validated planned amount for one category.
#[derive(Debug, Clone, Copy)]
pub struct PlannedAmount {
    pub category_id_index: usize,
    pub amount: Decimal,
}

/// Builds one month's category lines.
///
/// `planned`: `(category_id, planned_amount)` pairs, one per category with
/// a target this month -- a category with no entry gets `0` planned.
/// `previous_remaining`: the prior month's `remaining` per category, or
/// empty for a category's first month (no rollover).
/// `spent`: this month's actual spend per category, from summing
/// categorized transactions (see `transaction::spend_by_category`).
///
/// Every `Decimal` argument must be finite -- rust_decimal has no NaN/Inf,
/// so a validation error here only fires for a negative planned amount,
/// which is the one shape that would silently invert the zero-based math
/// (a category "planned" at -50 would show as 50 already spent).
pub fn build_month(
    planned: &[(String, Decimal)],
    previous_remaining: &[(String, Decimal)],
    spent: &[(String, Decimal)],
) -> BudgetResult<Vec<CategoryLine>> {
    for (_, amount) in planned {
        if amount.is_sign_negative() {
            return Err(BudgetError::NegativePlannedAmount(amount.to_string()));
        }
    }

    let rollover_of = |id: &str| -> Decimal {
        previous_remaining
            .iter()
            .find(|(cid, _)| cid == id)
            .map(|(_, v)| *v)
            .unwrap_or(Decimal::ZERO)
    };
    let spent_of = |id: &str| -> Decimal {
        spent
            .iter()
            .find(|(cid, _)| cid == id)
            .map(|(_, v)| *v)
            .unwrap_or(Decimal::ZERO)
    };

    Ok(planned
        .iter()
        .map(|(id, amount)| build_line(id.clone(), *amount, rollover_of(id), spent_of(id)))
        .collect())
}

/// The synthetic category id the Savings row uses for its planned-amount
/// storage -- never a real `Category` record (see `build_savings_line`'s
/// own doc comment for why), so nothing else validates this id against
/// `budget-ports`' categories table. `www/src/savings.js` defines the
/// identical literal; the two must stay in sync the same way
/// `commitments.js`'s `GOAL_PREFIX`/`DEBT_PREFIX` already are frontend-
/// only synthetic ids `build_month` treats opaquely.
pub const SAVINGS_CATEGORY_ID: &str = "__savings__";

/// The Savings row's line for one month. Unlike every other category,
/// its actual isn't summed from its own transactions -- there are none,
/// since Savings is never a category a transaction can be filed under --
/// it's the residual of what's left once every expense category's actual
/// is subtracted from income: literally what got saved, not what someone
/// remembered to log against a Savings bucket by hand.
///
/// Reuses `build_line`'s own planned-minus-actual arithmetic (with
/// rollover fixed at zero, same simplification every other category
/// currently has -- see CLAUDE.md) rather than a second formula that
/// could drift from it.
pub fn build_savings_line(
    planned: Decimal,
    income: Decimal,
    total_expense_actual: Decimal,
) -> BudgetResult<CategoryLine> {
    if planned.is_sign_negative() {
        return Err(BudgetError::NegativePlannedAmount(planned.to_string()));
    }
    let actual = income - total_expense_actual;
    Ok(build_line(
        SAVINGS_CATEGORY_ID.to_string(),
        planned,
        Decimal::ZERO,
        actual,
    ))
}

/// The month's headline numbers: total planned, total spent, and how much
/// of income is still unassigned -- the number a true zero-based budget
/// drives to zero.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct MonthSummary {
    pub income: Decimal,
    pub total_planned: Decimal,
    pub total_spent: Decimal,
    pub unassigned: Decimal,
    /// Income minus what has actually been spent this month -- unlike
    /// `unassigned` (income minus what's *planned*), this tracks the plan
    /// against real transactions. Negative means spending has already run
    /// past income, regardless of what was planned.
    pub unspent: Decimal,
}

pub fn summarize_month(income: Decimal, lines: &[CategoryLine]) -> MonthSummary {
    let total_planned: Decimal = lines.iter().map(|l| l.planned).sum();
    let total_spent: Decimal = lines.iter().map(|l| l.spent).sum();
    MonthSummary {
        income: round_currency(income),
        total_planned: round_currency(total_planned),
        total_spent: round_currency(total_spent),
        unassigned: round_currency(income - total_planned),
        unspent: round_currency(income - total_spent),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn a_blank_category_name_is_rejected() {
        assert_eq!(
            Category::new("c1", "  ", "Living", false, ""),
            Err(BudgetError::BlankCategoryName)
        );
    }

    #[test]
    fn a_category_carries_the_income_flag_it_was_given() {
        assert!(
            !Category::new("c1", "Rent", "Home", false, "")
                .unwrap()
                .is_income
        );
        assert!(
            Category::new("c2", "Salary", "Income", true, "")
                .unwrap()
                .is_income
        );
    }

    #[test]
    fn a_category_with_no_planned_entry_gets_zero_planned() {
        let lines = build_month(&[], &[], &[]).unwrap();
        assert!(lines.is_empty());
    }

    #[test]
    fn overspend_produces_a_negative_remaining_not_an_error() {
        let planned = vec![("dining".to_string(), dec!(200))];
        let spent = vec![("dining".to_string(), dec!(240))];
        let lines = build_month(&planned, &[], &spent).unwrap();
        assert_eq!(lines[0].remaining, dec!(-40));
    }

    #[test]
    fn last_months_overspend_carries_in_as_negative_rollover() {
        let planned = vec![("dining".to_string(), dec!(200))];
        let previous = vec![("dining".to_string(), dec!(-40))];
        let lines = build_month(&planned, &previous, &[]).unwrap();
        // 200 planned - 40 carried debt - 0 spent so far = 160 actually available
        assert_eq!(lines[0].remaining, dec!(160));
    }

    #[test]
    fn a_negative_planned_amount_is_rejected() {
        let planned = vec![("dining".to_string(), dec!(-1))];
        let err = build_month(&planned, &[], &[]).unwrap_err();
        assert_eq!(err, BudgetError::NegativePlannedAmount("-1".to_string()));
    }

    #[test]
    fn unassigned_is_income_minus_total_planned() {
        let planned = vec![
            ("dining".to_string(), dec!(200)),
            ("rent".to_string(), dec!(1500)),
        ];
        let lines = build_month(&planned, &[], &[]).unwrap();
        let summary = summarize_month(dec!(2000), &lines);
        assert_eq!(summary.unassigned, dec!(300));
    }

    #[test]
    fn a_fully_assigned_zero_based_budget_has_zero_unassigned() {
        let planned = vec![("rent".to_string(), dec!(2000))];
        let lines = build_month(&planned, &[], &[]).unwrap();
        let summary = summarize_month(dec!(2000), &lines);
        assert_eq!(summary.unassigned, dec!(0));
    }

    #[test]
    fn unspent_is_income_minus_total_spent() {
        let planned = vec![("dining".to_string(), dec!(200)), ("rent".to_string(), dec!(1500))];
        let spent = vec![("dining".to_string(), dec!(150)), ("rent".to_string(), dec!(1500))];
        let lines = build_month(&planned, &[], &spent).unwrap();
        let summary = summarize_month(dec!(2000), &lines);
        assert_eq!(summary.unspent, dec!(350));
    }

    #[test]
    fn spending_past_income_gives_a_negative_unspent() {
        let planned = vec![("dining".to_string(), dec!(200))];
        let spent = vec![("dining".to_string(), dec!(600))];
        let lines = build_month(&planned, &[], &spent).unwrap();
        let summary = summarize_month(dec!(500), &lines);
        assert_eq!(summary.unspent, dec!(-100));
    }

    #[test]
    fn savings_actual_is_income_minus_total_expense_actual() {
        let line = build_savings_line(dec!(500), dec!(3000), dec!(2200)).unwrap();
        assert_eq!(line.spent, dec!(800));
        assert_eq!(line.category_id, SAVINGS_CATEGORY_ID);
    }

    #[test]
    fn saving_more_than_planned_gives_a_negative_remaining_same_as_income_running_ahead() {
        // Planned to save 500, actually saved 800 -- exceeding the target,
        // which reads as good news the same way an income category
        // running ahead of plan does elsewhere in this app.
        let line = build_savings_line(dec!(500), dec!(3000), dec!(2200)).unwrap();
        assert_eq!(line.remaining, dec!(-300));
    }

    #[test]
    fn falling_short_of_the_savings_target_gives_a_positive_remaining() {
        // Planned to save 500, expenses ate into it -- only 200 actually left.
        let line = build_savings_line(dec!(500), dec!(3000), dec!(2800)).unwrap();
        assert_eq!(line.spent, dec!(200));
        assert_eq!(line.remaining, dec!(300));
    }

    #[test]
    fn spending_more_than_income_gives_a_negative_savings_actual() {
        let line = build_savings_line(dec!(0), dec!(2000), dec!(2500)).unwrap();
        assert_eq!(line.spent, dec!(-500));
    }

    #[test]
    fn a_negative_savings_target_is_rejected_same_as_any_other_category() {
        let err = build_savings_line(dec!(-1), dec!(2000), dec!(1000)).unwrap_err();
        assert_eq!(err, BudgetError::NegativePlannedAmount("-1".to_string()));
    }
}
