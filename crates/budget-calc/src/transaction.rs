//! Transactions and the summary math that feeds `category::build_month`.

use chrono::{Datelike, Duration};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use budget_core::round_currency;
use crate::date_util::{month_bounds, parse_date};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Transaction {
    pub id: String,
    /// ISO 8601 date (`YYYY-MM-DD`). A plain string, not a typed date:
    /// this crate never does date arithmetic on a transaction's own date
    /// (only on goal/debt schedules, which take an explicit `as_of`), so a
    /// parsed type would buy nothing and cost every caller a conversion.
    pub date: String,
    pub description: String,
    /// Positive for income, negative for spending -- a bank statement's
    /// own convention, which is also what keeps `spend_by_category` a
    /// plain sum rather than a sign-flipping special case.
    pub amount: Decimal,
    /// `None` until a rule matches or the person picks one by hand.
    pub category_id: Option<String>,
}

impl Transaction {
    /// `Decimal` has no NaN/Infinity, so there is no invalid-amount case to
    /// reject here -- unlike the `f64` a JS caller sends, which budget-wasm
    /// validates *before* it becomes a `Decimal` (mirroring mortgage-wasm's
    /// `percent_to_rate`).
    pub fn new(
        id: impl Into<String>,
        date: impl Into<String>,
        description: impl Into<String>,
        amount: Decimal,
    ) -> Self {
        Self {
            id: id.into(),
            date: date.into(),
            description: description.into(),
            amount: round_currency(amount),
            category_id: None,
        }
    }
}

/// Spend per category, as `category::build_month` wants it: only the
/// spending side (negative amounts), summed to a positive figure per
/// category, uncategorized transactions dropped rather than silently
/// pooled under one category.
pub fn spend_by_category(transactions: &[Transaction]) -> Vec<(String, Decimal)> {
    let mut totals: Vec<(String, Decimal)> = Vec::new();
    for t in transactions {
        let Some(id) = &t.category_id else { continue };
        if t.amount.is_sign_positive() {
            continue;
        }
        let spend = -t.amount;
        match totals.iter_mut().find(|(cid, _)| cid == id) {
            Some((_, total)) => *total += spend,
            None => totals.push((id.clone(), spend)),
        }
    }
    for (_, total) in &mut totals {
        *total = round_currency(*total);
    }
    totals
}

/// Income per category: the mirror image of `spend_by_category`, summing
/// the positive side of this month's transactions instead of the
/// negative. Exists for `Category.is_income` categories -- "how much of
/// what I planned to earn actually landed" is a different question from
/// "how much of what I planned to spend actually went out", and needed
/// its own total rather than overloading `spend_by_category`'s, which a
/// category flagged `is_income` should never draw from (that would silently
/// report $0 for every income category, since none of its transactions
/// are negative).
pub fn income_by_category(transactions: &[Transaction]) -> Vec<(String, Decimal)> {
    let mut totals: Vec<(String, Decimal)> = Vec::new();
    for t in transactions {
        let Some(id) = &t.category_id else { continue };
        if t.amount.is_sign_negative() {
            continue;
        }
        match totals.iter_mut().find(|(cid, _)| cid == id) {
            Some((_, total)) => *total += t.amount,
            None => totals.push((id.clone(), t.amount)),
        }
    }
    for (_, total) in &mut totals {
        *total = round_currency(*total);
    }
    totals
}

/// Total spending per day, across every expense transaction regardless of
/// category -- unlike `spend_by_category`, an uncategorized transaction
/// still counts here, since a day's total should reflect money that left,
/// not whether it has been filed away yet. Sorted by date ascending: the
/// timeseries chart this feeds needs that order, and a plain running total
/// wouldn't give it for free.
pub fn daily_spend(transactions: &[Transaction]) -> Vec<(String, Decimal)> {
    let mut totals: Vec<(String, Decimal)> = Vec::new();
    for t in transactions {
        if t.amount.is_sign_positive() {
            continue;
        }
        let spend = -t.amount;
        match totals.iter_mut().find(|(date, _)| date == &t.date) {
            Some((_, total)) => *total += spend,
            None => totals.push((t.date.clone(), spend)),
        }
    }
    for (_, total) in &mut totals {
        *total = round_currency(*total);
    }
    totals.sort_by(|a, b| a.0.cmp(&b.0));
    totals
}

/// Total spending per ISO week (Monday-start) within `month`, clipped to
/// that month's own days -- mirrors `daily_spend`'s shape (a sparse list
/// of buckets that had spending, not a zero-padded full calendar) and its
/// calling convention (callers already pass only this month's own
/// transactions, same as `daily_spend`'s callers do; a transaction
/// outside `month` is defensively dropped rather than trusted).
///
/// The date returned per bucket is the *clipped* week-start: the later of
/// (that week's real Monday, `month`'s first day) -- so a week that
/// straddles two months keys off day 1 of `month` rather than a day
/// belonging to the previous month. `www/src/month.js`'s `weeksInMonth`
/// builds the matching clipped week-boundary list for the chart's x-axis
/// using the identical rule; the two must never disagree about where a
/// boundary week starts.
pub fn weekly_spend(transactions: &[Transaction], month: &str) -> Vec<(String, Decimal)> {
    let Some((month_start, month_end)) = month_bounds(month) else {
        return Vec::new();
    };
    let mut totals: Vec<(chrono::NaiveDate, Decimal)> = Vec::new();
    for t in transactions {
        if t.amount.is_sign_positive() {
            continue;
        }
        let Some(date) = parse_date(&t.date) else { continue };
        if date < month_start || date > month_end {
            continue;
        }
        let monday = date - Duration::days(date.weekday().num_days_from_monday() as i64);
        let bucket_start = monday.max(month_start);
        let spend = -t.amount;
        match totals.iter_mut().find(|(d, _)| *d == bucket_start) {
            Some((_, total)) => *total += spend,
            None => totals.push((bucket_start, spend)),
        }
    }
    for (_, total) in &mut totals {
        *total = round_currency(*total);
    }
    totals.sort_by(|a, b| a.0.cmp(&b.0));
    totals
        .into_iter()
        .map(|(d, amt)| (d.format("%Y-%m-%d").to_string(), amt))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    fn t(desc: &str, amount: Decimal, category: Option<&str>) -> Transaction {
        let mut tx = Transaction::new("id", "2026-08-01", desc, amount);
        tx.category_id = category.map(str::to_string);
        tx
    }

    #[test]
    fn spend_by_category_sums_only_the_negative_side() {
        let txs = vec![
            t("coffee", dec!(-5), Some("dining")),
            t("lunch", dec!(-15), Some("dining")),
            t("salary", dec!(3000), Some("dining")), // income never counts as spend
        ];
        let spend = spend_by_category(&txs);
        assert_eq!(spend, vec![("dining".to_string(), dec!(20))]);
    }

    #[test]
    fn an_uncategorized_transaction_is_excluded_rather_than_pooled() {
        let txs = vec![t("mystery", dec!(-10), None)];
        assert_eq!(spend_by_category(&txs), vec![]);
    }

    #[test]
    fn income_by_category_sums_only_the_positive_side() {
        let txs = vec![
            t("salary", dec!(3000), Some("salary")),
            t("bonus", dec!(500), Some("salary")),
            t("rent", dec!(-2000), Some("salary")), // spending never counts as income
        ];
        let income = income_by_category(&txs);
        assert_eq!(income, vec![("salary".to_string(), dec!(3500))]);
    }

    #[test]
    fn income_by_category_excludes_an_uncategorized_transaction() {
        let txs = vec![t("mystery deposit", dec!(10), None)];
        assert_eq!(income_by_category(&txs), vec![]);
    }

    fn d(date: &str, desc: &str, amount: Decimal, category: Option<&str>) -> Transaction {
        let mut tx = Transaction::new("id", date, desc, amount);
        tx.category_id = category.map(str::to_string);
        tx
    }

    #[test]
    fn daily_spend_sums_only_the_negative_side_per_day() {
        let txs = vec![
            d("2026-08-01", "coffee", dec!(-5), Some("dining")),
            d("2026-08-01", "lunch", dec!(-15), Some("dining")),
            d("2026-08-01", "salary", dec!(3000), Some("dining")), // income excluded
            d("2026-08-02", "dinner", dec!(-20), Some("dining")),
        ];
        assert_eq!(
            daily_spend(&txs),
            vec![
                ("2026-08-01".to_string(), dec!(20)),
                ("2026-08-02".to_string(), dec!(20))
            ]
        );
    }

    #[test]
    fn daily_spend_includes_an_uncategorized_transaction() {
        let txs = vec![d("2026-08-01", "mystery", dec!(-10), None)];
        assert_eq!(
            daily_spend(&txs),
            vec![("2026-08-01".to_string(), dec!(10))]
        );
    }

    #[test]
    fn daily_spend_is_sorted_by_date_ascending_regardless_of_input_order() {
        let txs = vec![
            d("2026-08-15", "late", dec!(-3), None),
            d("2026-08-01", "early", dec!(-1), None),
            d("2026-08-08", "mid", dec!(-2), None),
        ];
        let dates: Vec<String> = daily_spend(&txs)
            .into_iter()
            .map(|(date, _)| date)
            .collect();
        assert_eq!(dates, vec!["2026-08-01", "2026-08-08", "2026-08-15"]);
    }

    #[test]
    fn daily_spend_on_no_transactions_is_empty() {
        assert_eq!(daily_spend(&[]), vec![]);
    }

    #[test]
    fn weekly_spend_sums_only_the_negative_side_per_week() {
        let txs = vec![
            d("2026-08-03", "coffee", dec!(-5), Some("dining")), // Mon, week of Aug 3
            d("2026-08-04", "lunch", dec!(-15), Some("dining")), // Tue, same week
            d("2026-08-03", "salary", dec!(3000), Some("dining")), // income excluded
            d("2026-08-10", "dinner", dec!(-20), Some("dining")), // next week
        ];
        assert_eq!(
            weekly_spend(&txs, "2026-08"),
            vec![
                ("2026-08-03".to_string(), dec!(20)),
                ("2026-08-10".to_string(), dec!(20))
            ]
        );
    }

    #[test]
    fn weekly_spend_clips_a_boundary_crossing_week_to_the_months_own_days() {
        // 2026-03-01 is a Sunday; its real ISO week runs Mon 2026-02-23
        // through Sun 2026-03-01. The bucket key must be the month's own
        // first day (2026-03-01), not the February Monday.
        let txs = vec![d("2026-03-01", "coffee", dec!(-4), Some("dining"))];
        assert_eq!(
            weekly_spend(&txs, "2026-03"),
            vec![("2026-03-01".to_string(), dec!(4))]
        );
    }

    #[test]
    fn weekly_spend_excludes_a_transaction_outside_the_month() {
        let txs = vec![d("2026-07-31", "leak", dec!(-9), Some("dining"))];
        assert_eq!(weekly_spend(&txs, "2026-08"), vec![]);
    }

    #[test]
    fn weekly_spend_is_sorted_by_week_start_ascending() {
        let txs = vec![
            d("2026-08-24", "late", dec!(-3), None),
            d("2026-08-03", "early", dec!(-1), None),
            d("2026-08-10", "mid", dec!(-2), None),
        ];
        let starts: Vec<String> = weekly_spend(&txs, "2026-08")
            .into_iter()
            .map(|(d, _)| d)
            .collect();
        assert_eq!(starts, vec!["2026-08-03", "2026-08-10", "2026-08-24"]);
    }

    #[test]
    fn weekly_spend_includes_an_uncategorized_transaction() {
        let txs = vec![d("2026-08-03", "mystery", dec!(-10), None)];
        assert_eq!(
            weekly_spend(&txs, "2026-08"),
            vec![("2026-08-03".to_string(), dec!(10))]
        );
    }

    #[test]
    fn weekly_spend_on_no_transactions_is_empty() {
        assert_eq!(weekly_spend(&[], "2026-08"), vec![]);
    }

    #[test]
    fn weekly_spend_on_an_unparseable_month_is_empty_not_a_panic() {
        assert_eq!(
            weekly_spend(&[d("2026-08-03", "x", dec!(-1), None)], "not-a-month"),
            vec![]
        );
    }
}
