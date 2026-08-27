//! Transactions and the summary math that feeds `category::build_month`.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use budget_core::round_currency;

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
}
