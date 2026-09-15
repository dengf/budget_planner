//! Sinking funds / savings goals, and the milestone detection behind the
//! low-stress design brief: a goal's progress is expressed as how many of
//! the brand blossom's five petals are filled (see meifio-brand/build.py's
//! PETAL, five-fold at 72 degrees), and a milestone fires once, the moment
//! a threshold is crossed -- never as a streak that can break.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use budget_core::{round_currency, BudgetError, BudgetResult, Cadence};

/// One month's savings moved into one goal.
///
/// The ledger exists for a single reason: a month's savings can only be
/// allocated once. Without it, tapping "add September's savings" twice
/// would add it twice, and the blossom would be as wrong as the
/// hand-typed number it replaced -- just harder to notice.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Contribution {
    /// `YYYY-MM` -- the month whose savings this came from, not the date
    /// it was recorded. Someone catching up in October on September's
    /// savings is allocating September.
    pub month: String,
    pub amount: Decimal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Goal {
    pub id: String,
    pub name: String,
    pub target_amount: Decimal,
    pub current_amount: Decimal,
    /// ISO 8601 date the goal is wanted by.
    pub target_date: String,
    pub cadence: Cadence,
    /// Which months' savings have already been moved in. `serde(default)`
    /// because every goal stored before this existed has none, and an
    /// empty ledger is exactly right for them: nothing was allocated
    /// through this path, so nothing is double-counted by it.
    ///
    /// Deliberately *not* the source of `current_amount`. A goal can also
    /// be funded by typing a number in, which is how every goal worked
    /// before this and still works for money that never passed through
    /// this app's idea of a month. The two move together only inside
    /// `apply_contribution`, which is the one place both are written.
    #[serde(default)]
    pub contributions: Vec<Contribution>,
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
            contributions: Vec::new(),
        })
    }
}

/// How much of `month`'s savings has already gone into this goal.
pub fn contributed_in_month(goal: &Goal, month: &str) -> Decimal {
    goal.contributions
        .iter()
        .filter(|c| c.month == month)
        .map(|c| c.amount)
        .sum()
}

/// How much of `month`'s savings has gone into *any* goal.
///
/// Across all goals, not one: a month produced one pot of savings, and
/// two goals each claiming the whole of it would describe money that was
/// never there.
pub fn allocated_in_month(goals: &[Goal], month: &str) -> Decimal {
    goals.iter().map(|g| contributed_in_month(g, month)).sum()
}

/// How much of `month`'s savings is still free to allocate.
///
/// `savings_actual` is the residual `build_savings_line` already computes
/// -- income minus everything spent -- so this deliberately creates no
/// transaction and subtracts nothing from any category. Money moved into
/// a goal *is* money that was saved; recording it as spending would
/// contradict the very figure it came from.
///
/// Floors at zero. A month whose savings later shrank (a transaction
/// added afterwards) can leave more allocated than was actually saved,
/// and the honest report of that is "nothing left to allocate", not a
/// negative amount offered as if it could be added.
pub fn unallocated_savings(savings_actual: Decimal, goals: &[Goal], month: &str) -> Decimal {
    round_currency((savings_actual - allocated_in_month(goals, month)).max(Decimal::ZERO))
}

/// Which true thing there is to say about a month's savings and the
/// goals claiming it.
///
/// A ladder, not a number, for the same reason `month_setup_state` is
/// one: the four cases need four different sentences, and picking
/// between them by comparing two figures in the frontend is exactly the
/// duplicated rule this crate exists to hold. `FullyAllocated` and
/// `OverAllocated` in particular both leave `unallocated_savings` at
/// zero, so nothing downstream can tell them apart from that number
/// alone -- and "all of it is assigned" said about a month that saved
/// less than was assigned is a confident wrong statement, not a
/// rounding difference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SavingsAllocationState {
    /// The month has no savings to assign: it broke even or overspent.
    NothingSaved,
    /// Some of the month's savings is still free.
    Unallocated,
    /// Every dollar the month saved is claimed by a goal, exactly.
    FullyAllocated,
    /// More was moved into goals from this month than the month ended up
    /// saving -- which happens when spending is logged *after* a
    /// contribution was made, and is worth saying out loud rather than
    /// rounding away.
    OverAllocated,
}

/// See `SavingsAllocationState`.
pub fn savings_allocation_state(
    savings_actual: Decimal,
    goals: &[Goal],
    month: &str,
) -> SavingsAllocationState {
    let allocated = allocated_in_month(goals, month);
    if savings_actual <= Decimal::ZERO {
        // An overspent month with nothing assigned has nothing to report
        // beyond that; one with something assigned is over-allocated by
        // every dollar of it.
        return if allocated > Decimal::ZERO {
            SavingsAllocationState::OverAllocated
        } else {
            SavingsAllocationState::NothingSaved
        };
    }
    match allocated.cmp(&savings_actual) {
        std::cmp::Ordering::Less => SavingsAllocationState::Unallocated,
        std::cmp::Ordering::Equal => SavingsAllocationState::FullyAllocated,
        std::cmp::Ordering::Greater => SavingsAllocationState::OverAllocated,
    }
}

/// A goal after a contribution, plus whatever milestone that crossed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GoalContribution {
    /// The updated goal, ready to store. Returned whole rather than as a
    /// delta so `current_amount` and the ledger cannot be written apart
    /// from one another by a caller that updates only one.
    pub goal: Goal,
    pub milestone: Option<Milestone>,
}

/// Moves `amount` of `month`'s savings into `goal`.
///
/// Both halves happen here or neither does: `current_amount` rises and
/// the month's ledger row records it. A second contribution in the same
/// month merges into that row instead of appending a duplicate, so
/// `contributed_in_month` stays a simple sum and the ledger keeps one row
/// per month.
///
/// Rejects a non-positive amount. Withdrawing from a goal is a different
/// action with different meaning (it does not give the month's savings
/// back), and letting it in through this door would silently corrupt the
/// ledger this function exists to keep honest.
pub fn apply_contribution(
    goal: &Goal,
    month: &str,
    amount: Decimal,
) -> BudgetResult<GoalContribution> {
    if !amount.is_sign_positive() || amount.is_zero() {
        return Err(BudgetError::InvalidAmount(amount.to_string()));
    }
    let amount = round_currency(amount);
    let previous = goal.current_amount;
    let new_current = round_currency(previous + amount);

    let mut updated = goal.clone();
    updated.current_amount = new_current;
    match updated.contributions.iter_mut().find(|c| c.month == month) {
        Some(existing) => existing.amount = round_currency(existing.amount + amount),
        None => updated.contributions.push(Contribution {
            month: month.to_string(),
            amount,
        }),
    }

    Ok(GoalContribution {
        milestone: milestone_crossed(previous, new_current, goal.target_amount),
        goal: updated,
    })
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

    fn goal(target: Decimal, current: Decimal) -> Goal {
        let mut g = Goal::new("g", "Laptop", target, "2027-01-01", Cadence::Monthly).unwrap();
        g.current_amount = current;
        g
    }

    #[test]
    fn a_goal_stored_before_the_ledger_existed_reads_as_having_allocated_nothing() {
        // The compatibility case: `contributions` is serde(default), and
        // an empty ledger must mean "nothing was allocated through this
        // path", never "unknown".
        let stored = r#"{"id":"g","name":"Laptop","target_amount":"1000",
            "current_amount":"250","target_date":"2027-01-01","cadence":"monthly"}"#;
        let g: Goal = serde_json::from_str(stored).unwrap();
        assert_eq!(g.current_amount, dec!(250));
        assert!(g.contributions.is_empty());
        assert_eq!(contributed_in_month(&g, "2026-09"), dec!(0));
    }

    #[test]
    fn a_contribution_raises_the_goal_and_records_the_month_together() {
        let out = apply_contribution(&goal(dec!(1000), dec!(100)), "2026-09", dec!(400)).unwrap();
        assert_eq!(out.goal.current_amount, dec!(500));
        assert_eq!(contributed_in_month(&out.goal, "2026-09"), dec!(400));
    }

    #[test]
    fn a_second_contribution_in_the_same_month_merges_into_one_ledger_row() {
        let first = apply_contribution(&goal(dec!(1000), dec!(0)), "2026-09", dec!(300)).unwrap();
        let second = apply_contribution(&first.goal, "2026-09", dec!(200)).unwrap();
        assert_eq!(second.goal.current_amount, dec!(500));
        assert_eq!(second.goal.contributions.len(), 1);
        assert_eq!(contributed_in_month(&second.goal, "2026-09"), dec!(500));
    }

    #[test]
    fn contributions_from_different_months_are_kept_apart() {
        let sep = apply_contribution(&goal(dec!(1000), dec!(0)), "2026-09", dec!(300)).unwrap();
        let oct = apply_contribution(&sep.goal, "2026-10", dec!(200)).unwrap();
        assert_eq!(contributed_in_month(&oct.goal, "2026-09"), dec!(300));
        assert_eq!(contributed_in_month(&oct.goal, "2026-10"), dec!(200));
    }

    #[test]
    fn a_contribution_that_crosses_a_threshold_reports_the_milestone() {
        let out = apply_contribution(&goal(dec!(1000), dec!(400)), "2026-09", dec!(150)).unwrap();
        assert_eq!(out.milestone, Some(Milestone::Halfway));
    }

    #[test]
    fn a_non_positive_contribution_is_rejected() {
        assert!(apply_contribution(&goal(dec!(1000), dec!(0)), "2026-09", dec!(0)).is_err());
        assert!(apply_contribution(&goal(dec!(1000), dec!(0)), "2026-09", dec!(-50)).is_err());
    }

    #[test]
    fn a_month_with_savings_left_over_reports_unallocated() {
        let g = apply_contribution(&goal(dec!(1000), dec!(0)), "2026-09", dec!(300))
            .unwrap()
            .goal;
        assert_eq!(
            savings_allocation_state(dec!(800), &[g], "2026-09"),
            SavingsAllocationState::Unallocated
        );
    }

    #[test]
    fn a_month_claimed_to_the_dollar_reports_fully_allocated() {
        let g = apply_contribution(&goal(dec!(1000), dec!(0)), "2026-09", dec!(800))
            .unwrap()
            .goal;
        assert_eq!(
            savings_allocation_state(dec!(800), &[g], "2026-09"),
            SavingsAllocationState::FullyAllocated
        );
    }

    /// The case the frontend used to describe as "all of it is assigned":
    /// money went into a goal, then more spending was logged for the same
    /// month, and the month turned out to have saved less than was moved.
    #[test]
    fn savings_shrinking_after_a_contribution_reports_over_allocated() {
        let g = apply_contribution(&goal(dec!(10000), dec!(0)), "2026-09", dec!(3680))
            .unwrap()
            .goal;
        assert_eq!(
            savings_allocation_state(dec!(2180), std::slice::from_ref(&g), "2026-09"),
            SavingsAllocationState::OverAllocated
        );
        // And there is still nothing free to offer, so the two halves
        // agree.
        assert_eq!(unallocated_savings(dec!(2180), &[g], "2026-09"), dec!(0));
    }

    #[test]
    fn a_month_that_saved_nothing_and_assigned_nothing_reports_nothing_saved() {
        assert_eq!(
            savings_allocation_state(dec!(0), &[], "2026-09"),
            SavingsAllocationState::NothingSaved
        );
        assert_eq!(
            savings_allocation_state(dec!(-50), &[], "2026-09"),
            SavingsAllocationState::NothingSaved
        );
    }

    /// An overspent month that nevertheless has a contribution recorded
    /// against it is over-allocated, not "nothing saved" -- there is
    /// money in a goal that this month did not produce.
    #[test]
    fn an_overspent_month_with_a_contribution_reports_over_allocated() {
        let g = apply_contribution(&goal(dec!(1000), dec!(0)), "2026-09", dec!(200))
            .unwrap()
            .goal;
        assert_eq!(
            savings_allocation_state(dec!(-40), &[g], "2026-09"),
            SavingsAllocationState::OverAllocated
        );
    }

    /// The rule that stops a month's savings being spent twice: it is one
    /// pot, shared across every goal, not one pot per goal.
    #[test]
    fn savings_already_allocated_to_one_goal_are_not_offered_to_another() {
        let laptop = apply_contribution(&goal(dec!(1000), dec!(0)), "2026-09", dec!(300))
            .unwrap()
            .goal;
        let trip = goal(dec!(2000), dec!(0));
        let goals = vec![laptop, trip];
        assert_eq!(allocated_in_month(&goals, "2026-09"), dec!(300));
        assert_eq!(unallocated_savings(dec!(800), &goals, "2026-09"), dec!(500));
    }

    #[test]
    fn a_month_with_nothing_allocated_offers_the_whole_savings_figure() {
        assert_eq!(unallocated_savings(dec!(800), &[], "2026-09"), dec!(800));
    }

    #[test]
    fn allocating_the_whole_month_leaves_nothing_more_to_offer() {
        let g = apply_contribution(&goal(dec!(1000), dec!(0)), "2026-09", dec!(800))
            .unwrap()
            .goal;
        assert_eq!(unallocated_savings(dec!(800), &[g], "2026-09"), dec!(0));
    }

    /// A transaction added after the fact can shrink a month's savings
    /// below what was already moved out of it. "Nothing left" is the
    /// honest answer; a negative offer is not.
    #[test]
    fn savings_that_shrank_after_allocation_offer_nothing_rather_than_a_negative() {
        let g = apply_contribution(&goal(dec!(1000), dec!(0)), "2026-09", dec!(800))
            .unwrap()
            .goal;
        assert_eq!(unallocated_savings(dec!(500), &[g], "2026-09"), dec!(0));
    }

    /// Savings is a residual (income minus everything spent), so a month
    /// that overspent has no savings to allocate at all.
    #[test]
    fn a_month_that_overspent_offers_nothing() {
        assert_eq!(unallocated_savings(dec!(-200), &[], "2026-09"), dec!(0));
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
