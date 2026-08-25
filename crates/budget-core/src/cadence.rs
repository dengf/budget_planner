use serde::{Deserialize, Serialize};

/// How often a recurring thing recurs -- a goal contribution, a bill.
///
/// Kept separate from any one month's calendar: `months_between` and
/// `periods_per_year` are the only calendar facts a cadence carries, and
/// callers do their own date arithmetic with them (see
/// `budget_calc::goals`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Cadence {
    Weekly,
    Fortnightly,
    Monthly,
    Quarterly,
    Yearly,
}

impl Cadence {
    pub fn periods_per_year(self) -> u32 {
        match self {
            Cadence::Weekly => 52,
            Cadence::Fortnightly => 26,
            Cadence::Monthly => 12,
            Cadence::Quarterly => 4,
            Cadence::Yearly => 1,
        }
    }
}
