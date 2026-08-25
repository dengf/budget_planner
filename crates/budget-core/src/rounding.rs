use rust_decimal::Decimal;

/// Rounds to whole cents.
///
/// `Decimal::round_dp` uses banker's rounding (half to even) at the
/// midpoint, matching rust_decimal's own default -- not "half up". A
/// transaction amount is never a computed midpoint in practice (it comes
/// from a bank statement, already at the cent), so this only matters for
/// *derived* figures like a required monthly contribution.
pub fn round_currency(value: Decimal) -> Decimal {
    value.round_dp(2)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn rounds_to_the_nearest_cent() {
        assert_eq!(round_currency(dec!(1.006)), dec!(1.01));
        assert_eq!(round_currency(dec!(1.001)), dec!(1.00));
    }

    #[test]
    fn a_midpoint_rounds_to_even_not_always_up() {
        assert_eq!(round_currency(dec!(1.005)), dec!(1.00));
        assert_eq!(round_currency(dec!(1.015)), dec!(1.02));
    }
}
