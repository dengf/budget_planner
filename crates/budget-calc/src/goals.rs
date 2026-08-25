//! Sinking funds / savings goals, and the milestone detection behind the
//! low-stress design brief: a goal's progress is expressed as how many of
//! the brand blossom's five petals are filled (see meifio-brand/build.py's
//! PETAL, five-fold at 72 degrees), and a milestone fires once, the moment
//! a threshold is crossed -- never as a streak that can break.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use budget_core::{round_currency, BudgetError, BudgetResult, Cadence};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Goal {
    pub id: String,
    pub name: String,
    pub target_amount: Decimal,
    pub current_amount: Decimal,
    /// ISO 8601 date the goal is wanted by.
    pub target_date: String,
    pub cadence: Cadence,
}

impl Goal {
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        target_amount: Decimal,
        target_date: impl Into<String>,
        cadence: Cadence,
    ) -> BudgetResult<Self> {
        if target_amount.is_sign_negative() || target_amount.is_zero() {
            return Err(BudgetError::InvalidGoalTarget(target_amount.to_string()));
        }
        Ok(Self {
            id: id.into(),
            name: name.into(),
            target_amount: round_currency(target_amount),
            current_amount: Decimal::ZERO,
            target_date: target_date.into(),
            cadence,
        })
    }
}

/// How full a goal is, clamped to `[0, 1]` -- a goal can be overfunded
/// (extra saved beyond the target), and that must not read as "600% done".
pub fn progress_ratio(current: Decimal, target: Decimal) -> Decimal {
    if target.is_zero() {
        return Decimal::ZERO;
    }
    (current / target).clamp(Decimal::ZERO, Decimal::ONE)
}

/// How many of the blossom's five petals are filled, given progress. Rust
/// decides this, not the frontend, for the same reason every other
/// derived figure is decided here: a second, JS-side implementation of
/// "which fraction of five" could round differently and show a different
/// petal count than the number actually saved.
pub fn petals_filled(current: Decimal, target: Decimal) -> u8 {
    let ratio = progress_ratio(current, target);
    let five = Decimal::from(5);
    let filled = (ratio * five).floor();
    filled.try_into().unwrap_or(5).min(5)
}

/// One-time acknowledgements, ordered so the highest reached is checked
/// first -- a jump from 10% to 100% in one deposit should report the goal
/// as met, not merely "past a quarter".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Milestone {
    GoalReached,
    ThreeQuarters,
    Halfway,
    FirstQuarter,
}

fn thresholds() -> [(Milestone, Decimal); 4] {
    [
        (Milestone::GoalReached, Decimal::ONE),
        (Milestone::ThreeQuarters, Decimal::new(75, 2)),
        (Milestone::Halfway, Decimal::new(50, 2)),
        (Milestone::FirstQuarter, Decimal::new(25, 2)),
    ]
}

/// The highest milestone newly crossed by moving from `previous` to
/// `new_current`, or `None` if none was crossed (including moving
/// backward, e.g. a correction to a deposit).
///
/// This is what makes a milestone a one-time acknowledgement rather than a
/// streak: called once per contribution, with the amounts *before and
/// after* that contribution, so a deposit that doesn't cross a threshold
/// produces nothing to show.
pub fn milestone_crossed(
    previous: Decimal,
    new_current: Decimal,
    target: Decimal,
) -> Option<Milestone> {
    let before = progress_ratio(previous, target);
    let after = progress_ratio(new_current, target);
    thresholds()
        .into_iter()
        .find(|(_, threshold)| before < *threshold && after >= *threshold)
        .map(|(m, _)| m)
}

/// The amount still needed, evenly spread across the periods left before
/// `target_date` at the goal's cadence.
///
/// `months_remaining` is supplied by the caller (see budget-wasm's
/// `goals.rs`, which does the calendar arithmetic against
/// `js_sys::Date::now()`) rather than computed here, so this stays a pure
/// function of numbers with no clock dependency, testable without a
/// wasm32 target. Fewer than one period remaining is treated as one --
/// the whole shortfall is due now, not divided by zero or a negative
/// count.
pub fn required_contribution(
    target_amount: Decimal,
    current_amount: Decimal,
    months_remaining: i64,
    cadence: Cadence,
) -> Decimal {
    let remaining = (target_amount - current_amount).max(Decimal::ZERO);
    let periods_per_month = Decimal::from(cadence.periods_per_year()) / Decimal::from(12);
    let periods = Decimal::from(months_remaining.max(1)) * periods_per_month;
    let periods = periods.max(Decimal::ONE);
    round_currency(remaining / periods)
}

#[cfg(test)]
mod tests {
    use super::*;
    use budget_core::Cadence;
    use rust_decimal_macros::dec;

    #[test]
    fn a_zero_target_is_rejected() {
        assert!(Goal::new("g", "Trip", dec!(0), "2027-01-01", Cadence::Monthly).is_err());
    }

    #[test]
    fn progress_is_clamped_at_full_even_when_overfunded() {
        assert_eq!(progress_ratio(dec!(1200), dec!(1000)), Decimal::ONE);
    }

    #[test]
    fn petals_fill_in_fifths() {
        assert_eq!(petals_filled(dec!(0), dec!(500)), 0);
        assert_eq!(petals_filled(dec!(100), dec!(500)), 1);
        assert_eq!(petals_filled(dec!(499), dec!(500)), 4);
        assert_eq!(petals_filled(dec!(500), dec!(500)), 5);
        assert_eq!(petals_filled(dec!(9999), dec!(500)), 5);
    }

    #[test]
    fn crossing_a_threshold_reports_that_milestone() {
        let m = milestone_crossed(dec!(400), dec!(510), dec!(1000));
        assert_eq!(m, Some(Milestone::Halfway));
    }

    #[test]
    fn a_deposit_that_stays_within_a_band_reports_nothing() {
        let m = milestone_crossed(dec!(510), dec!(520), dec!(1000));
        assert_eq!(m, None);
    }

    #[test]
    fn jumping_straight_past_several_thresholds_reports_the_highest() {
        let m = milestone_crossed(dec!(100), dec!(1000), dec!(1000));
        assert_eq!(m, Some(Milestone::GoalReached));
    }

    #[test]
    fn a_correction_that_moves_backward_reports_nothing() {
        let m = milestone_crossed(dec!(600), dec!(400), dec!(1000));
        assert_eq!(m, None);
    }

    #[test]
    fn required_contribution_spreads_the_shortfall_evenly() {
        let c = required_contribution(dec!(1200), dec!(0), 12, Cadence::Monthly);
        assert_eq!(c, dec!(100));
    }

    #[test]
    fn a_goal_due_this_month_asks_for_the_whole_shortfall() {
        let c = required_contribution(dec!(500), dec!(200), 0, Cadence::Monthly);
        assert_eq!(c, dec!(300));
    }

    #[test]
    fn an_already_funded_goal_needs_no_further_contribution() {
        let c = required_contribution(dec!(500), dec!(600), 6, Cadence::Monthly);
        assert_eq!(c, dec!(0));
    }
}
