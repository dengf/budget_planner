//! Debt payoff planning: snowball and avalanche ordering across several
//! debts, sharing the amortization arithmetic proven out in meifio's
//! mortgage calculator (level monthly compounding, one period at a time)
//! rather than reinventing it.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use budget_core::{round_currency, BudgetError, BudgetResult};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Debt {
    pub id: String,
    pub name: String,
    pub balance: Decimal,
    /// Annual percentage rate, as a fraction (0.199 for 19.9%) -- same
    /// convention as mortgage-calc's `RateType`.
    pub apr: Decimal,
    pub min_payment: Decimal,
}

impl Debt {
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        balance: Decimal,
        apr: Decimal,
        min_payment: Decimal,
    ) -> BudgetResult<Self> {
        if balance.is_sign_negative() || balance.is_zero() {
            return Err(BudgetError::InvalidDebtBalance(balance.to_string()));
        }
        if apr.is_sign_negative() {
            return Err(BudgetError::InvalidDebtRate(apr.to_string()));
        }
        if min_payment.is_sign_negative() || min_payment.is_zero() {
            return Err(BudgetError::InvalidMinPayment(min_payment.to_string()));
        }
        Ok(Self {
            id: id.into(),
            name: name.into(),
            balance: round_currency(balance),
            apr,
            min_payment: round_currency(min_payment),
        })
    }

    fn monthly_rate(&self) -> Decimal {
        self.apr / Decimal::from(12)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Strategy {
    /// Smallest balance first -- optimizes for the motivation of an early
    /// payoff, not total interest paid. The strategy YNAB and most
    /// budgeting psychology research favour for adherence.
    Snowball,
    /// Highest APR first -- optimizes for total interest paid, at the
    /// cost of the first debt taking longer to close.
    Avalanche,
}

/// One month's snapshot for one debt within the plan.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PayoffMonth {
    pub month: u32,
    pub debt_id: String,
    pub interest: Decimal,
    pub payment: Decimal,
    pub remaining_balance: Decimal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PayoffPlan {
    /// Debt ids in the order they'll be focused on -- the snowball/
    /// avalanche ordering itself, before any month-by-month simulation.
    pub order: Vec<String>,
    pub schedule: Vec<PayoffMonth>,
    pub months_to_debt_free: u32,
    pub total_interest: Decimal,
}

fn ordered_ids(debts: &[Debt], strategy: Strategy) -> Vec<String> {
    let mut ordered: Vec<&Debt> = debts.iter().collect();
    match strategy {
        Strategy::Snowball => ordered.sort_by_key(|d| d.balance),
        Strategy::Avalanche => ordered.sort_by_key(|d| std::cmp::Reverse(d.apr)),
    }
    ordered.into_iter().map(|d| d.id.clone()).collect()
}

/// Simulates paying every debt's minimum, plus `extra_payment` applied to
/// whichever debt is first in `order` and still open -- the "snowball" (or
/// "avalanche") effect: once a debt closes, its former minimum joins the
/// extra pool for the next one, so the payment toward the focus debt grows
/// every time one is cleared.
///
/// Caps at `max_months` (a safety bound, not a business rule) so a
/// combination of a near-zero extra payment and a high APR can't spin the
/// simulation forever; callers surface that as "this plan doesn't pay
/// itself off" rather than a silent truncation.
pub fn build_plan(
    debts: &[Debt],
    extra_payment: Decimal,
    strategy: Strategy,
    max_months: u32,
) -> BudgetResult<PayoffPlan> {
    let total_minimums: Decimal = debts.iter().map(|d| d.min_payment).sum();
    if extra_payment.is_sign_negative() {
        return Err(BudgetError::PayoffBudgetTooSmall {
            minimums: total_minimums.to_string(),
            available: extra_payment.to_string(),
        });
    }

    let order = ordered_ids(debts, strategy);
    let mut balances: Vec<(String, Decimal)> =
        debts.iter().map(|d| (d.id.clone(), d.balance)).collect();
    let by_id = |id: &str| debts.iter().find(|d| d.id == id).unwrap();

    let mut schedule = Vec::new();
    let mut total_interest = Decimal::ZERO;
    let mut month = 0u32;

    while balances.iter().any(|(_, b)| *b > Decimal::ZERO) && month < max_months {
        month += 1;
        let mut pool = extra_payment;

        for id in &order {
            let debt = by_id(id);
            let balance = balances.iter_mut().find(|(bid, _)| bid == id).unwrap();
            if balance.1 <= Decimal::ZERO {
                // Already closed: its minimum joins the pool for whichever
                // debt is next in `order`, every month from here on. This
                // is the "snowball" itself -- without it, a closed debt's
                // minimum would simply vanish instead of accelerating the
                // next one.
                pool += debt.min_payment;
                continue;
            }

            let interest = round_currency(balance.1 * debt.monthly_rate());
            // A closed-earlier debt's minimum has already joined `pool`
            // via the running total below; this debt gets its own minimum
            // plus whatever extra is still unclaimed by an earlier debt in
            // `order` this month.
            let available = debt.min_payment + pool;
            let payment = available.min(balance.1 + interest);
            pool = (available - payment).max(Decimal::ZERO);

            balance.1 = round_currency((balance.1 + interest - payment).max(Decimal::ZERO));
            total_interest += interest;

            schedule.push(PayoffMonth {
                month,
                debt_id: id.clone(),
                interest,
                payment: round_currency(payment),
                remaining_balance: balance.1,
            });
        }
    }

    Ok(PayoffPlan {
        order,
        schedule,
        months_to_debt_free: month,
        total_interest: round_currency(total_interest),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    fn debt(id: &str, balance: Decimal, apr: Decimal, min: Decimal) -> Debt {
        Debt::new(id, id, balance, apr, min).unwrap()
    }

    #[test]
    fn a_zero_balance_debt_is_rejected() {
        assert!(Debt::new("d", "Card", dec!(0), dec!(0.2), dec!(25)).is_err());
    }

    #[test]
    fn snowball_orders_smallest_balance_first_regardless_of_rate() {
        let debts = vec![
            debt("big-cheap", dec!(5000), dec!(0.05), dec!(100)),
            debt("small-expensive", dec!(500), dec!(0.25), dec!(25)),
        ];
        let order = ordered_ids(&debts, Strategy::Snowball);
        assert_eq!(order, vec!["small-expensive", "big-cheap"]);
    }

    #[test]
    fn avalanche_orders_highest_rate_first_regardless_of_balance() {
        let debts = vec![
            debt("big-cheap", dec!(5000), dec!(0.05), dec!(100)),
            debt("small-expensive", dec!(500), dec!(0.25), dec!(25)),
        ];
        let order = ordered_ids(&debts, Strategy::Avalanche);
        assert_eq!(order, vec!["small-expensive", "big-cheap"]);
    }

    #[test]
    fn a_single_debt_with_no_interest_pays_off_in_balance_over_payment_months() {
        let debts = vec![debt("d", dec!(1000), dec!(0), dec!(100))];
        let plan = build_plan(&debts, dec!(0), Strategy::Snowball, 60).unwrap();
        assert_eq!(plan.months_to_debt_free, 10);
        assert_eq!(plan.total_interest, dec!(0));
    }

    #[test]
    fn a_closed_debts_minimum_snowballs_into_the_next_one() {
        let debts = vec![
            debt("small", dec!(200), dec!(0), dec!(100)),
            debt("large", dec!(2000), dec!(0), dec!(100)),
        ];
        // Month 1-2: "small" closes (200 / 100+extra). Its $100 minimum then
        // joins "large"'s payment from month 3 on.
        let plan = build_plan(&debts, dec!(0), Strategy::Snowball, 60).unwrap();
        let large_month_1 = plan
            .schedule
            .iter()
            .find(|m| m.debt_id == "large" && m.month == 1)
            .unwrap();
        let large_month_3 = plan
            .schedule
            .iter()
            .find(|m| m.debt_id == "large" && m.month == 3)
            .unwrap();
        assert!(large_month_3.payment > large_month_1.payment);
    }

    #[test]
    fn interest_accrues_monthly_on_the_remaining_balance() {
        // Minimum set to exactly balance + one month's interest, so the
        // debt closes in a single payment and the interest figure isn't
        // entangled with a second month's partial payoff.
        let debts = vec![debt("d", dec!(1000), dec!(0.12), dec!(1010))];
        let plan = build_plan(&debts, dec!(0), Strategy::Snowball, 12).unwrap();
        // 1% monthly on 1000 = 10.00.
        assert_eq!(plan.schedule[0].interest, dec!(10.00));
        assert_eq!(plan.months_to_debt_free, 1);
    }

    #[test]
    fn a_negative_extra_payment_is_rejected() {
        let debts = vec![debt("d", dec!(1000), dec!(0.1), dec!(50))];
        assert!(build_plan(&debts, dec!(-10), Strategy::Snowball, 12).is_err());
    }

    #[test]
    fn hitting_the_month_cap_reports_that_many_months_without_panicking() {
        // Minimum barely covers interest -- effectively never pays off.
        let debts = vec![debt("d", dec!(100000), dec!(0.30), dec!(50))];
        let plan = build_plan(&debts, dec!(0), Strategy::Snowball, 24).unwrap();
        assert_eq!(plan.months_to_debt_free, 24);
    }
}
