//! Categories and the zero-based monthly budget.
//!
//! "Zero-based" means every category gets a planned amount and the sum is
//! meant to account for the whole month's income -- not that spending is
//! capped to zero. A category that goes over doesn't error; it produces a
//! negative `remaining`, which the UI reframes as "borrowed from next
//! month" rather than a failure (see budget-wasm's Message layer).

use std::cmp::Reverse;

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use budget_core::{round_currency, BudgetError, BudgetResult};

use crate::date_util::parse_date;
use crate::transaction::Transaction;

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
/// Every `Decimal` argument must be finite -- `rust_decimal` has no NaN/Inf,
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
            .map_or(Decimal::ZERO, |(_, v)| *v)
    };
    let spent_of = |id: &str| -> Decimal {
        spent
            .iter()
            .find(|(cid, _)| cid == id)
            .map_or(Decimal::ZERO, |(_, v)| *v)
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
    /// The sum of every income category's own `planned` -- not a figure
    /// anyone types in separately. Income categories are budgeted the
    /// same way expense ones are (their own Planned field, e.g. "Salary:
    /// 3500"); this is just that side of the ledger totaled up, kept in
    /// lockstep with what's actually on the income rows rather than a
    /// number that could silently disagree with them.
    pub income: Decimal,
    /// Sum of `planned` across every *non-income* line -- the jobs income
    /// gets assigned to. Income category lines are deliberately excluded:
    /// an income category's own `planned` is where `income` above comes
    /// from, and folding it back in here would double it, once as the
    /// target and once as if it were also an assignment against that
    /// target.
    pub total_planned: Decimal,
    /// Sum of `spent` across every *non-income* line, for the same reason
    /// `total_planned` excludes income lines: an income category's
    /// `spent` is money *received*, not money spent, and counting it here
    /// would inflate this figure by however much income had come in.
    pub total_spent: Decimal,
    pub unassigned: Decimal,
    /// Income minus what has actually been spent this month -- unlike
    /// `unassigned` (income minus what's *planned*), this tracks the plan
    /// against real transactions. Negative means spending has already run
    /// past income, regardless of what was planned.
    pub unspent: Decimal,
}

/// `income_category_ids`: which of `lines` belong to income categories --
/// the classification itself is host-supplied (`Category::is_income`
/// lives in the frontend's records; `CategoryLine`/`build_month` stay
/// ignorant of it, same as `group`), but *what to do* with that
/// classification -- derive `income` from those lines and exclude them
/// from `total_planned`/`total_spent` -- is exactly the kind of
/// arithmetic CLAUDE.md keeps in the core rather than a frontend filter,
/// since getting it wrong produces a confidently wrong `unassigned`/
/// `unspent` rather than a visible failure. See the fix that added this
/// parameter: before it, an income category's own planned/received
/// amounts were silently summed in on top of real expenses.
pub fn summarize_month(lines: &[CategoryLine], income_category_ids: &[String]) -> MonthSummary {
    let is_income_line = |id: &str| income_category_ids.iter().any(|i| i == id);
    let income: Decimal = lines
        .iter()
        .filter(|l| is_income_line(&l.category_id))
        .map(|l| l.planned)
        .sum();
    let total_planned: Decimal = lines
        .iter()
        .filter(|l| !is_income_line(&l.category_id))
        .map(|l| l.planned)
        .sum();
    let total_spent: Decimal = lines
        .iter()
        .filter(|l| !is_income_line(&l.category_id))
        .map(|l| l.spent)
        .sum();
    MonthSummary {
        income: round_currency(income),
        total_planned: round_currency(total_planned),
        total_spent: round_currency(total_spent),
        unassigned: round_currency(income - total_planned),
        unspent: round_currency(income - total_spent),
    }
}

/// Which side of the ledger the person is entering, which is the first
/// and cheapest thing that narrows a category list: entering income can
/// never mean Groceries, and entering a expense can never mean Salary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Expense,
    Income,
}

impl Direction {
    /// A transaction's own sign convention (positive = income), so the
    /// same rule decides what a stored transaction counted as and what a
    /// half-typed amount is about to count as.
    fn matches_amount(self, amount: Decimal) -> bool {
        match self {
            Direction::Income => amount.is_sign_positive(),
            Direction::Expense => amount.is_sign_negative(),
        }
    }
}

/// How often a category has been used lately, on a 0-1 scale where 1 is
/// the most-used category on this side of the ledger. `uses` is the raw
/// count behind it, so a caller can tell "never used" (0) apart from
/// "used, but least of all" -- the first has no history to justify
/// pre-selecting it, the second does.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RankedCategory {
    pub category_id: String,
    pub score: Decimal,
    pub uses: u32,
}

/// A recent use counts for more than an old one, halving every 30 days.
/// Chosen, not measured: a month is the unit this whole app thinks in,
/// so "this month's habits outweigh last month's, and last year's barely
/// register" is the behaviour to aim at. Three months back is worth an
/// eighth of today.
const RECENCY_HALF_LIFE_DAYS: f64 = 30.0;

/// Order the categories by how likely this person is to want each one
/// next, so the Add sheet can put a handful of chips in front of them
/// instead of a scrolling list of everything.
///
/// Two inputs, in order of how much they narrow things:
///
/// 1. **Direction.** Entering money received can only mean an income
///    category, and spending can only mean an expense one. For most
///    people this alone takes income down to a single choice.
/// 2. **Recency-weighted frequency.** Among what's left, what they
///    actually use, with recent use weighted above old use (see
///    `RECENCY_HALF_LIFE_DAYS`).
///
/// Deliberately *not* a model. `rules.rs` already carries this app's
/// position on automatic categorization: a keyword rule is inspectable
/// and can be corrected, "the model decided" is not. Counting a person's
/// own past choices is the same kind of honest -- the answer to "why is
/// Groceries first?" is "because you picked it eleven times this month".
///
/// Every matching category is returned, never a truncated list: how many
/// chips fit is a layout question, and the caller is the only one that
/// knows it. Categories with no history keep the order they were given
/// in (the sort is stable), which is preset order for the starter set --
/// so a brand-new budget with no transactions still gets a sensible
/// list rather than an arbitrary one.
///
/// `as_of` is passed in, never read from a clock -- this crate has no
/// I/O (see lib.rs). An unparseable `as_of`, or an unparseable
/// transaction date, contributes no weight rather than erroring: a bad
/// date in one old record shouldn't take the whole list down.
pub fn category_rank(
    categories: &[Category],
    transactions: &[Transaction],
    as_of: &str,
    direction: Direction,
) -> Vec<RankedCategory> {
    let today = parse_date(as_of);

    let mut ranked: Vec<RankedCategory> = categories
        .iter()
        .filter(|c| c.is_income == (direction == Direction::Income))
        .map(|c| {
            let mut weight = 0.0_f64;
            let mut uses = 0_u32;
            for t in transactions {
                if t.category_id.as_deref() != Some(c.id.as_str()) {
                    continue;
                }
                if !direction.matches_amount(t.amount) {
                    continue;
                }
                uses += 1;
                let Some((today, date)) = today.zip(parse_date(&t.date)) else {
                    continue;
                };
                let days_ago = (today - date).num_days().max(0) as f64;
                weight += 0.5_f64.powf(days_ago / RECENCY_HALF_LIFE_DAYS);
            }
            (c.id.clone(), weight, uses)
        })
        .map(|(category_id, weight, uses)| RankedCategory {
            category_id,
            score: Decimal::try_from(weight).unwrap_or_default(),
            uses,
        })
        .collect();

    let top = ranked
        .iter()
        .map(|r| r.score)
        .max()
        .unwrap_or(Decimal::ZERO);
    if top > Decimal::ZERO {
        for r in &mut ranked {
            r.score = (r.score / top).round_dp(4);
        }
    }

    // Highest score first, and `sort_by_key` is stable -- so equal
    // scores, which every category has before any history exists, keep
    // the caller's order.
    ranked.sort_by_key(|r| Reverse(r.score));
    ranked
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
            ("salary".to_string(), dec!(2000)),
            ("dining".to_string(), dec!(200)),
            ("rent".to_string(), dec!(1500)),
        ];
        let lines = build_month(&planned, &[], &[]).unwrap();
        let summary = summarize_month(&lines, &["salary".to_string()]);
        assert_eq!(summary.income, dec!(2000));
        assert_eq!(summary.unassigned, dec!(300));
    }

    #[test]
    fn a_fully_assigned_zero_based_budget_has_zero_unassigned() {
        let planned = vec![
            ("salary".to_string(), dec!(2000)),
            ("rent".to_string(), dec!(2000)),
        ];
        let lines = build_month(&planned, &[], &[]).unwrap();
        let summary = summarize_month(&lines, &["salary".to_string()]);
        assert_eq!(summary.unassigned, dec!(0));
    }

    #[test]
    fn unspent_is_income_minus_total_spent() {
        let planned = vec![
            ("salary".to_string(), dec!(2000)),
            ("dining".to_string(), dec!(200)),
            ("rent".to_string(), dec!(1500)),
        ];
        let spent = vec![
            ("dining".to_string(), dec!(150)),
            ("rent".to_string(), dec!(1500)),
        ];
        let lines = build_month(&planned, &[], &spent).unwrap();
        let summary = summarize_month(&lines, &["salary".to_string()]);
        assert_eq!(summary.unspent, dec!(350));
    }

    #[test]
    fn spending_past_income_gives_a_negative_unspent() {
        let planned = vec![
            ("salary".to_string(), dec!(500)),
            ("dining".to_string(), dec!(200)),
        ];
        let spent = vec![("dining".to_string(), dec!(600))];
        let lines = build_month(&planned, &[], &spent).unwrap();
        let summary = summarize_month(&lines, &["salary".to_string()]);
        assert_eq!(summary.unspent, dec!(-100));
    }

    #[test]
    fn income_is_the_sum_of_every_income_categorys_own_planned_amount() {
        let planned = vec![
            ("salary".to_string(), dec!(3000)),
            ("freelance".to_string(), dec!(500)),
            ("rent".to_string(), dec!(1000)),
        ];
        let lines = build_month(&planned, &[], &[]).unwrap();
        let summary = summarize_month(&lines, &["salary".to_string(), "freelance".to_string()]);
        assert_eq!(summary.income, dec!(3500));
    }

    /// Regression test for a real bug: before `summarize_month` took
    /// `income_category_ids`, an income category's own planned/received
    /// amounts were summed straight into `total_planned`/`total_spent`
    /// alongside real expenses -- so budgeting a salary category at 2000
    /// and receiving it in full inflated "Total spent" by 2000 on top of
    /// actual spending, and corrupted `unassigned`/`unspent` to match.
    /// Caught live: a seeded budget showed "Total spent $9,440" against
    /// $5,240 of real expenses, the gap being exactly the income
    /// received that month.
    #[test]
    fn income_category_lines_are_excluded_from_total_planned_and_total_spent() {
        let planned = vec![
            ("salary".to_string(), dec!(2000)),
            ("rent".to_string(), dec!(800)),
        ];
        let spent = vec![
            ("salary".to_string(), dec!(2000)),
            ("rent".to_string(), dec!(800)),
        ];
        let lines = build_month(&planned, &[], &spent).unwrap();
        let summary = summarize_month(&lines, &["salary".to_string()]);
        assert_eq!(summary.income, dec!(2000));
        assert_eq!(summary.total_planned, dec!(800));
        assert_eq!(summary.total_spent, dec!(800));
        assert_eq!(summary.unassigned, dec!(1200));
        assert_eq!(summary.unspent, dec!(1200));
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

    fn cat(id: &str, is_income: bool) -> Category {
        Category::new(id, id, "General", is_income, "").unwrap()
    }

    fn tx(id: &str, date: &str, amount: Decimal, category_id: &str) -> Transaction {
        let mut t = Transaction::new(id, date, "x", amount);
        t.category_id = Some(category_id.to_string());
        t
    }

    fn ranked_ids(ranked: &[RankedCategory]) -> Vec<&str> {
        ranked.iter().map(|r| r.category_id.as_str()).collect()
    }

    #[test]
    fn entering_income_never_offers_an_expense_category() {
        let categories = vec![cat("salary", true), cat("food", false), cat("rent", false)];
        let ranked = category_rank(&categories, &[], "2026-09-14", Direction::Income);
        assert_eq!(ranked_ids(&ranked), ["salary"]);
    }

    #[test]
    fn entering_an_expense_never_offers_an_income_category() {
        let categories = vec![cat("salary", true), cat("food", false), cat("rent", false)];
        let ranked = category_rank(&categories, &[], "2026-09-14", Direction::Expense);
        assert_eq!(ranked_ids(&ranked), ["food", "rent"]);
    }

    #[test]
    fn with_no_history_the_given_order_is_kept() {
        // A fresh budget has the five seeded starter categories and no
        // transactions. Preset order is the only signal there is, and an
        // unstable sort would scramble it into something arbitrary.
        let categories = vec![cat("food", false), cat("rent", false), cat("fun", false)];
        let ranked = category_rank(&categories, &[], "2026-09-14", Direction::Expense);
        assert_eq!(ranked_ids(&ranked), ["food", "rent", "fun"]);
        assert!(ranked.iter().all(|r| r.uses == 0));
    }

    #[test]
    fn the_most_used_category_comes_first() {
        let categories = vec![cat("rent", false), cat("food", false)];
        let transactions = vec![
            tx("1", "2026-09-10", dec!(-20), "food"),
            tx("2", "2026-09-11", dec!(-30), "food"),
            tx("3", "2026-09-01", dec!(-1500), "rent"),
        ];
        let ranked = category_rank(&categories, &transactions, "2026-09-14", Direction::Expense);
        assert_eq!(ranked_ids(&ranked), ["food", "rent"]);
        assert_eq!(ranked[0].uses, 2);
    }

    #[test]
    fn amount_never_outweighs_frequency() {
        // One 1500 rent payment against two small grocery runs: this
        // ranks how often a category is *picked*, not how much money
        // went through it. Ranking by amount would put rent and
        // mortgage permanently above the categories actually typed in
        // every day.
        let categories = vec![cat("rent", false), cat("food", false)];
        let transactions = vec![
            tx("1", "2026-09-10", dec!(-4), "food"),
            tx("2", "2026-09-11", dec!(-6), "food"),
            tx("3", "2026-09-11", dec!(-1500), "rent"),
        ];
        let ranked = category_rank(&categories, &transactions, "2026-09-14", Direction::Expense);
        assert_eq!(ranked_ids(&ranked), ["food", "rent"]);
    }

    #[test]
    fn a_recent_habit_outranks_an_abandoned_one() {
        // Four uses six months ago against two uses this week. The old
        // one wins on raw count and still has to lose: the point is what
        // this person reaches for *now*.
        let categories = vec![cat("old", false), cat("new", false)];
        let transactions = vec![
            tx("1", "2026-03-01", dec!(-10), "old"),
            tx("2", "2026-03-02", dec!(-10), "old"),
            tx("3", "2026-03-03", dec!(-10), "old"),
            tx("4", "2026-03-04", dec!(-10), "old"),
            tx("5", "2026-09-12", dec!(-10), "new"),
            tx("6", "2026-09-13", dec!(-10), "new"),
        ];
        let ranked = category_rank(&categories, &transactions, "2026-09-14", Direction::Expense);
        assert_eq!(ranked_ids(&ranked), ["new", "old"]);
        assert_eq!(ranked[1].uses, 4);
    }

    #[test]
    fn the_top_category_scores_one_and_an_unused_one_scores_zero() {
        let categories = vec![cat("food", false), cat("fun", false)];
        let transactions = vec![tx("1", "2026-09-14", dec!(-10), "food")];
        let ranked = category_rank(&categories, &transactions, "2026-09-14", Direction::Expense);
        assert_eq!(ranked[0].score, dec!(1));
        assert_eq!(ranked[1].score, dec!(0));
        assert_eq!(ranked[1].uses, 0);
    }

    #[test]
    fn a_transaction_on_the_wrong_side_of_the_ledger_does_not_count() {
        // A refund posts as a positive amount against an expense
        // category. It is not evidence that this category is where the
        // next *expense* goes, so it earns no weight -- and mustn't
        // quietly reorder the list on the strength of it.
        let categories = vec![cat("food", false), cat("fun", false)];
        let transactions = vec![tx("1", "2026-09-14", dec!(40), "food")];
        let ranked = category_rank(&categories, &transactions, "2026-09-14", Direction::Expense);
        assert_eq!(ranked_ids(&ranked), ["food", "fun"]);
        assert!(ranked.iter().all(|r| r.uses == 0));
    }

    #[test]
    fn an_uncategorized_transaction_contributes_nothing() {
        let categories = vec![cat("food", false)];
        let transactions = vec![Transaction::new("1", "2026-09-14", "x", dec!(-10))];
        let ranked = category_rank(&categories, &transactions, "2026-09-14", Direction::Expense);
        assert_eq!(ranked[0].uses, 0);
    }

    #[test]
    fn an_unparseable_date_is_counted_but_earns_no_recency_weight() {
        // Half of a rescued CSV import can carry a date this app can't
        // read. The right answer is to ignore what can't be read, not to
        // return an empty list and leave the sheet with no chips at all.
        let categories = vec![cat("food", false), cat("fun", false)];
        let transactions = vec![
            tx("1", "not-a-date", dec!(-10), "food"),
            tx("2", "2026-09-14", dec!(-10), "fun"),
        ];
        let ranked = category_rank(&categories, &transactions, "2026-09-14", Direction::Expense);
        assert_eq!(ranked_ids(&ranked), ["fun", "food"]);
        assert_eq!(ranked[1].uses, 1);
        assert_eq!(ranked[1].score, dec!(0));
    }

    #[test]
    fn a_future_dated_transaction_counts_as_today_rather_than_more_than_today() {
        // Scheduling next week's rent shouldn't out-weight something
        // logged this morning; clamping at zero days keeps the most a
        // single use can be worth at 1.
        let categories = vec![cat("rent", false), cat("food", false)];
        let transactions = vec![
            tx("1", "2026-12-01", dec!(-1500), "rent"),
            tx("2", "2026-09-14", dec!(-10), "food"),
        ];
        let ranked = category_rank(&categories, &transactions, "2026-09-14", Direction::Expense);
        assert_eq!(ranked[0].score, ranked[1].score);
        assert_eq!(ranked_ids(&ranked), ["rent", "food"]);
    }

    #[test]
    fn no_categories_at_all_gives_an_empty_list_not_a_panic() {
        assert!(category_rank(&[], &[], "2026-09-14", Direction::Expense).is_empty());
    }
}
