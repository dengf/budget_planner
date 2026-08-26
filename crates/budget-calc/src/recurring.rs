//! Recurring expenses -- rent, subscriptions, anything on a schedule --
//! and which calendar dates they actually land on within a given month.
//!
//! Exists to answer a specific, well-articulated complaint from real
//! budgeting-app users (a long-standing Actual Budget feature request,
//! github.com/actualbudget/actual/issues/543): "I pay $500 rent every
//! Friday. Some months there are four Fridays, some months five. I want
//! to know which, and see it reflected in my budget *before* the money
//! is gone, not after." A flat `amount * occurrences_per_year / 12`
//! estimate gets a 5-Friday month wrong by a whole occurrence; only
//! walking the actual calendar gets it right, which is why this is a
//! Rust module and not a JS one-liner -- it is exactly the kind of
//! "second implementation could give a different answer" arithmetic
//! CLAUDE.md keeps out of the front end.

use chrono::{Datelike, Duration, NaiveDate};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use budget_core::{round_currency, BudgetError, BudgetResult, Cadence};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecurringExpense {
    pub id: String,
    pub description: String,
    pub category_id: String,
    /// Per-occurrence amount, always positive -- "what rent costs," not a
    /// signed transaction amount.
    pub amount: Decimal,
    pub cadence: Cadence,
    /// ISO 8601 date of one real occurrence, anchoring the schedule: the
    /// weekday for Weekly/Fortnightly, the day-of-month for
    /// Monthly/Quarterly/Yearly. No occurrence exists before this date --
    /// a subscription that started in March has no occurrence in January.
    pub anchor_date: String,
}

impl RecurringExpense {
    pub fn new(
        id: impl Into<String>,
        description: impl Into<String>,
        category_id: impl Into<String>,
        amount: Decimal,
        cadence: Cadence,
        anchor_date: impl Into<String>,
    ) -> BudgetResult<Self> {
        if !amount.is_sign_positive() || amount.is_zero() {
            return Err(BudgetError::InvalidRecurringAmount(amount.to_string()));
        }
        Ok(Self {
            id: id.into(),
            description: description.into(),
            category_id: category_id.into(),
            amount: round_currency(amount),
            cadence,
            anchor_date: anchor_date.into(),
        })
    }
}

/// One calendar occurrence of a recurring expense.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Occurrence {
    pub recurring_id: String,
    pub category_id: String,
    pub description: String,
    pub amount: Decimal,
    /// ISO 8601 date this specific occurrence falls on.
    pub date: String,
}

fn parse_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

/// `(first day, last day)` of a `YYYY-MM` month. `None` on a string that
/// doesn't parse -- an unparseable anchor or month produces zero
/// occurrences rather than a panic; see `occurrences_in_month`.
fn month_bounds(month: &str) -> Option<(NaiveDate, NaiveDate)> {
    let (year_str, month_str) = month.split_once('-')?;
    let year: i32 = year_str.parse().ok()?;
    let mon: u32 = month_str.parse().ok()?;
    let start = NaiveDate::from_ymd_opt(year, mon, 1)?;
    let next_start = if mon == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)?
    } else {
        NaiveDate::from_ymd_opt(year, mon + 1, 1)?
    };
    Some((start, next_start - Duration::days(1)))
}

/// The last valid day of `year`-`month` -- 28, 29, 30 or 31. Used to clamp
/// a monthly/quarterly/yearly anchor's day-of-month: a subscription
/// anchored on the 31st still bills every month, on the last day of the
/// months that don't have one.
fn last_day_of_month(year: i32, month: u32) -> u32 {
    let next_month_start = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    }
    .expect("month is 1..=12, so the next month always exists");
    (next_month_start - Duration::days(1)).day()
}

/// Every date within `month` (`YYYY-MM`) that `expense` falls due on.
///
/// Weekly and fortnightly are walked by calendar phase against the
/// anchor's weekday, so a 5-Friday month genuinely returns 5 dates and a
/// 4-Friday month returns 4 -- the exact distinction the GitHub issue this
/// module answers asked for. Monthly/quarterly/yearly return at most one
/// date, on the anchor's day-of-month (clamped) if the cadence lands on
/// this month at all.
pub fn occurrences_in_month(expense: &RecurringExpense, month: &str) -> Vec<NaiveDate> {
    let Some(anchor) = parse_date(&expense.anchor_date) else {
        return Vec::new();
    };
    let Some((start, end)) = month_bounds(month) else {
        return Vec::new();
    };
    if end < anchor {
        // The whole month is before the schedule starts.
        return Vec::new();
    }

    match expense.cadence {
        Cadence::Weekly | Cadence::Fortnightly => {
            let step = Duration::days(if expense.cadence == Cadence::Weekly {
                7
            } else {
                14
            });
            // First occurrence on or after `start`: either the anchor
            // itself (if the schedule starts mid-month) or `start`
            // advanced to the anchor's phase, found by the remainder of
            // days-since-anchor rather than stepping from the anchor date
            // one period at a time -- a rent schedule anchored years ago
            // must not cost a loop proportional to its age.
            let mut cursor = if start <= anchor {
                anchor
            } else {
                let days_since = (start - anchor).num_days();
                let remainder = days_since % step.num_days();
                if remainder == 0 {
                    start
                } else {
                    start + Duration::days(step.num_days() - remainder)
                }
            };
            let mut dates = Vec::new();
            while cursor <= end {
                dates.push(cursor);
                cursor += step;
            }
            dates
        }
        Cadence::Monthly => {
            if (start.year(), start.month()) < (anchor.year(), anchor.month()) {
                return Vec::new();
            }
            let day = anchor
                .day()
                .min(last_day_of_month(start.year(), start.month()));
            NaiveDate::from_ymd_opt(start.year(), start.month(), day)
                .into_iter()
                .collect()
        }
        Cadence::Quarterly => {
            if (start.year(), start.month()) < (anchor.year(), anchor.month()) {
                return Vec::new();
            }
            let months_since =
                (start.year() - anchor.year()) * 12 + start.month() as i32 - anchor.month() as i32;
            if months_since % 3 != 0 {
                return Vec::new();
            }
            let day = anchor
                .day()
                .min(last_day_of_month(start.year(), start.month()));
            NaiveDate::from_ymd_opt(start.year(), start.month(), day)
                .into_iter()
                .collect()
        }
        Cadence::Yearly => {
            if start.year() < anchor.year() || start.month() != anchor.month() {
                return Vec::new();
            }
            let day = anchor
                .day()
                .min(last_day_of_month(start.year(), start.month()));
            NaiveDate::from_ymd_opt(start.year(), start.month(), day)
                .into_iter()
                .collect()
        }
    }
}

/// Every occurrence of every expense in `month`, earliest first.
pub fn occurrences_for_month(expenses: &[RecurringExpense], month: &str) -> Vec<Occurrence> {
    let mut out: Vec<Occurrence> = expenses
        .iter()
        .flat_map(|e| {
            occurrences_in_month(e, month)
                .into_iter()
                .map(move |date| Occurrence {
                    recurring_id: e.id.clone(),
                    category_id: e.category_id.clone(),
                    description: e.description.clone(),
                    amount: e.amount,
                    date: date.format("%Y-%m-%d").to_string(),
                })
        })
        .collect();
    out.sort_by(|a, b| a.date.cmp(&b.date));
    out
}

/// `occurrences`, summed by category -- same `(category_id, total)` shape
/// as `transaction::spend_by_category`, so the front end can treat
/// "what's scheduled" and "what's already spent" as the same kind of
/// figure.
pub fn totals_by_category(occurrences: &[Occurrence]) -> Vec<(String, Decimal)> {
    let mut totals: Vec<(String, Decimal)> = Vec::new();
    for o in occurrences {
        match totals.iter_mut().find(|(cid, _)| *cid == o.category_id) {
            Some((_, total)) => *total += o.amount,
            None => totals.push((o.category_id.clone(), o.amount)),
        }
    }
    for (_, total) in &mut totals {
        *total = round_currency(*total);
    }
    totals
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    fn weekly_rent(anchor: &str) -> RecurringExpense {
        RecurringExpense::new(
            "rent",
            "Rent",
            "housing",
            dec!(500),
            Cadence::Weekly,
            anchor,
        )
        .unwrap()
    }

    #[test]
    fn a_negative_or_zero_amount_is_rejected() {
        assert_eq!(
            RecurringExpense::new("r", "x", "c", dec!(0), Cadence::Monthly, "2026-01-01"),
            Err(BudgetError::InvalidRecurringAmount("0".to_string()))
        );
        assert!(
            RecurringExpense::new("r", "x", "c", dec!(-5), Cadence::Monthly, "2026-01-01").is_err()
        );
    }

    /// The exact case the GitHub issue raised: weekly rent on a Friday
    /// anchor produces 4 occurrences in a 4-Friday month and 5 in a
    /// 5-Friday month -- never a flat estimate. Computed from the
    /// calendar itself (via `chrono`), not a hardcoded real month, so the
    /// test doesn't depend on which real year is current.
    #[test]
    fn weekly_occurrences_match_the_real_number_of_that_weekday_in_the_month() {
        // Find a real anchor Friday, then walk forward to a month with
        // exactly 4 Fridays and one with exactly 5, however far out that
        // is -- proving the counts differ rather than assuming it.
        let anchor = NaiveDate::from_weekday_of_month_opt(2026, 1, chrono::Weekday::Fri, 1)
            .expect("January 2026 has a first Friday");
        let expense = weekly_rent(&anchor.format("%Y-%m-%d").to_string());

        let mut four_friday_month = None;
        let mut five_friday_month = None;
        let (mut y, mut m) = (anchor.year(), anchor.month());
        for _ in 0..36 {
            let month = format!("{y:04}-{m:02}");
            let count = occurrences_in_month(&expense, &month).len();
            if count == 4 && four_friday_month.is_none() {
                four_friday_month = Some(month.clone());
            }
            if count == 5 && five_friday_month.is_none() {
                five_friday_month = Some(month.clone());
            }
            m += 1;
            if m > 12 {
                m = 1;
                y += 1;
            }
        }

        let four = four_friday_month.expect("no 4-Friday month found in the probe window");
        let five = five_friday_month.expect("no 5-Friday month found in the probe window");
        assert_eq!(occurrences_in_month(&expense, &four).len(), 4);
        assert_eq!(occurrences_in_month(&expense, &five).len(), 5);

        // And every date returned really is a Friday.
        for date in occurrences_in_month(&expense, &five) {
            assert_eq!(date.weekday(), chrono::Weekday::Fri);
        }
    }

    #[test]
    fn no_occurrence_exists_before_the_anchor_date() {
        let expense = RecurringExpense::new(
            "sub",
            "New subscription",
            "personal",
            dec!(10),
            Cadence::Monthly,
            "2026-03-15",
        )
        .unwrap();
        assert!(occurrences_in_month(&expense, "2026-01").is_empty());
        assert!(occurrences_in_month(&expense, "2026-02").is_empty());
        assert_eq!(occurrences_in_month(&expense, "2026-03").len(), 1);
        assert_eq!(occurrences_in_month(&expense, "2026-04").len(), 1);
    }

    #[test]
    fn monthly_on_the_31st_clamps_to_the_last_day_of_a_shorter_month() {
        let expense = RecurringExpense::new(
            "rent2",
            "Rent",
            "housing",
            dec!(1000),
            Cadence::Monthly,
            "2026-01-31",
        )
        .unwrap();
        let feb = occurrences_in_month(&expense, "2026-02");
        assert_eq!(feb, vec![NaiveDate::from_ymd_opt(2026, 2, 28).unwrap()]);
        let apr = occurrences_in_month(&expense, "2026-04");
        assert_eq!(apr, vec![NaiveDate::from_ymd_opt(2026, 4, 30).unwrap()]);
    }

    #[test]
    fn quarterly_lands_every_third_month_from_the_anchor() {
        let expense = RecurringExpense::new(
            "ins",
            "Insurance",
            "health",
            dec!(300),
            Cadence::Quarterly,
            "2026-01-15",
        )
        .unwrap();
        assert_eq!(occurrences_in_month(&expense, "2026-01").len(), 1);
        assert!(occurrences_in_month(&expense, "2026-02").is_empty());
        assert!(occurrences_in_month(&expense, "2026-03").is_empty());
        assert_eq!(occurrences_in_month(&expense, "2026-04").len(), 1);
        assert_eq!(occurrences_in_month(&expense, "2026-07").len(), 1);
    }

    #[test]
    fn yearly_lands_once_a_year_on_the_anchor_month() {
        let expense = RecurringExpense::new(
            "reg",
            "Car registration",
            "transport",
            dec!(150),
            Cadence::Yearly,
            "2025-09-10",
        )
        .unwrap();
        assert!(occurrences_in_month(&expense, "2026-08").is_empty());
        assert_eq!(occurrences_in_month(&expense, "2026-09").len(), 1);
        assert!(occurrences_in_month(&expense, "2027-08").is_empty());
        assert_eq!(occurrences_in_month(&expense, "2027-09").len(), 1);
    }

    #[test]
    fn occurrences_for_month_is_sorted_and_totals_by_category_sums_correctly() {
        let expenses = vec![
            weekly_rent("2026-01-02"), // a Friday
            RecurringExpense::new(
                "sub",
                "Netflix",
                "personal",
                dec!(15),
                Cadence::Monthly,
                "2026-01-05",
            )
            .unwrap(),
        ];
        let occ = occurrences_for_month(&expenses, "2026-01");
        let dates: Vec<_> = occ.iter().map(|o| o.date.clone()).collect();
        let mut sorted = dates.clone();
        sorted.sort();
        assert_eq!(
            dates, sorted,
            "occurrences_for_month must return dates in order"
        );

        let totals = totals_by_category(&occ);
        let housing = totals.iter().find(|(c, _)| c == "housing").unwrap().1;
        // 4 or 5 Fridays in January 2026, times 500 each.
        let friday_count = occurrences_in_month(&weekly_rent("2026-01-02"), "2026-01").len() as i64;
        assert_eq!(housing, dec!(500) * Decimal::from(friday_count));
        let personal = totals.iter().find(|(c, _)| c == "personal").unwrap().1;
        assert_eq!(personal, dec!(15));
    }

    #[test]
    fn an_unparseable_anchor_produces_no_occurrences_rather_than_panicking() {
        let expense = RecurringExpense {
            id: "bad".into(),
            description: "Corrupt record".into(),
            category_id: "c".into(),
            amount: dec!(10),
            cadence: Cadence::Monthly,
            anchor_date: "not-a-date".into(),
        };
        assert!(occurrences_in_month(&expense, "2026-01").is_empty());
    }
}
