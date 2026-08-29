//! Calendar-parsing plumbing shared by `recurring` and `transaction`.
//!
//! Not `pub mod` in `lib.rs` -- this has no domain content of its own (see
//! CLAUDE.md's business-logic/host-layer split), so `bridge_coverage`'s
//! `pub mod` scan never expects a wasm binding for it.

use chrono::{Duration, NaiveDate};

pub fn parse_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

/// `(first day, last day)` of a `YYYY-MM` month. `None` on a string that
/// doesn't parse -- callers turn that into "no result" rather than a panic.
pub fn month_bounds(month: &str) -> Option<(NaiveDate, NaiveDate)> {
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
