//! Turns plain text -- pulled from a photographed receipt via `ocr::run_ocr`
//! or from a digital PDF via `pdf_text::extract_pdf_text` -- into a draft
//! transaction for review.
//!
//! Deliberately not treated as ground truth the way a CSV row is: OCR and
//! a receipt's inconsistent layout are both far less reliable than a
//! bank's own export, so every field here is `Option`, nothing is ever
//! guessed when the text doesn't support it (an unparseable date stays
//! `None`, never defaults to today), and `www` never auto-saves what this
//! returns -- it lands in an editable review form first.
//!
//! Hand-rolled on purpose, same "plain and inspectable" philosophy as
//! `rules.rs`'s substring matching: no third-party "receipt AI" package
//! exists that's trustworthy or open-source, and even if one did, a
//! heuristic nobody can read is a worse fit for this app than one that's
//! occasionally wrong in an obvious, fixable way.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::csv_import::parse_amount;

const TOTAL_KEYWORDS: [&str; 3] = ["total", "amount due", "balance due"];
const INCOME_KEYWORDS: [&str; 6] = [
    "refund",
    "returned",
    "payment received",
    "credit",
    "reimbursement",
    "cash back",
];

const NUMERIC_DATE_FORMATS: [&str; 8] = [
    "%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%d/%m/%Y", "%m-%d-%Y", "%d-%m-%Y", "%m/%d/%y", "%d/%m/%y",
];
const NAMED_DATE_FORMATS: [&str; 4] = ["%B %d, %Y", "%b %d, %Y", "%d %B %Y", "%d %b %Y"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct ParsedReceipt {
    pub description: Option<String>,
    /// Signed like `Transaction::amount`: negative unless an income
    /// keyword fired. Always a guess, always editable afterward.
    pub amount: Option<Decimal>,
    /// ISO `YYYY-MM-DD`, or `None` if nothing in the text confidently
    /// parsed as a date.
    pub date: Option<String>,
    pub is_income: bool,
}

pub fn parse_receipt_text(text: &str) -> ParsedReceipt {
    let lines: Vec<&str> = text.lines().map(str::trim).collect();
    let lower_text = text.to_lowercase();

    let is_income = INCOME_KEYWORDS.iter().any(|k| lower_text.contains(k));
    let magnitude = find_total(&lines).or_else(|| largest_amount(&lines));

    ParsedReceipt {
        description: find_description(&lines),
        amount: magnitude.map(|m| if is_income { m } else { -m }),
        date: find_date(&lines),
        is_income,
    }
}

/// The first non-blank line, with leading/trailing punctuation (a
/// receipt's own `*** STORE ***` banner styling) trimmed off -- the
/// common receipt convention is the merchant name at the very top.
fn find_description(lines: &[&str]) -> Option<String> {
    lines
        .iter()
        .map(|l| l.trim_matches(|c: char| !c.is_alphanumeric()).trim())
        .find(|l| !l.is_empty())
        .map(|l| l.chars().take(80).collect())
}

/// Money-like tokens on a line: whitespace-split, each token must contain
/// a digit and a decimal point. That excludes bare item counts, receipt/
/// order numbers, and phone numbers, at the cost of a known v1 gap:
/// whole-dollar totals with no cents don't match. The mandatory review
/// step, not this heuristic, is what catches that.
fn extract_amounts(line: &str) -> Vec<Decimal> {
    line.split_whitespace()
        .filter(|t| t.contains('.') && t.chars().any(|c| c.is_ascii_digit()))
        .filter_map(parse_amount)
        .map(|d| d.abs())
        .collect()
}

/// The last line matching a total-keyword (never "subtotal") that yields
/// at least one money-like token -- "last" so a genuine bottom-of-receipt
/// "TOTAL $48.60" wins over an earlier, unrelated line containing the
/// same word.
fn find_total(lines: &[&str]) -> Option<Decimal> {
    let mut found = None;
    for line in lines {
        let lower = line.to_lowercase();
        if lower.contains("subtotal") {
            continue;
        }
        if !TOTAL_KEYWORDS.iter().any(|k| lower.contains(k)) {
            continue;
        }
        if let Some(max) = extract_amounts(line).into_iter().max() {
            found = Some(max);
        }
    }
    found
}

fn largest_amount(lines: &[&str]) -> Option<Decimal> {
    lines.iter().flat_map(|l| extract_amounts(l)).max()
}

fn find_date(lines: &[&str]) -> Option<String> {
    use chrono::NaiveDate;

    for line in lines {
        let words: Vec<&str> = line.split_whitespace().collect();
        for w in &words {
            let cleaned = w.trim_matches(|c: char| c == ',' || c == ':');
            for fmt in NUMERIC_DATE_FORMATS {
                if let Ok(d) = NaiveDate::parse_from_str(cleaned, fmt) {
                    return Some(d.format("%Y-%m-%d").to_string());
                }
            }
        }
        for window in words.windows(3) {
            let joined = window.join(" ");
            let cleaned = joined.trim_matches(|c: char| c == ',');
            for fmt in NAMED_DATE_FORMATS {
                if let Ok(d) = NaiveDate::parse_from_str(cleaned, fmt) {
                    return Some(d.format("%Y-%m-%d").to_string());
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn a_total_line_wins_over_subtotal_and_tax_lines() {
        let text = "WALMART\nSubtotal 45.00\nTax 3.60\nTotal 48.60\n";
        let parsed = parse_receipt_text(text);
        assert_eq!(parsed.amount, Some(dec!(-48.60)));
    }

    #[test]
    fn a_total_items_count_does_not_false_positive() {
        let text = "SHOP\nTotal items: 3\nTotal 48.60\n";
        let parsed = parse_receipt_text(text);
        assert_eq!(parsed.amount, Some(dec!(-48.60)));
    }

    #[test]
    fn falls_back_to_the_largest_amount_when_no_total_line_exists() {
        let text = "CAFE\nCoffee 4.50\nMuffin 3.25\n";
        let parsed = parse_receipt_text(text);
        assert_eq!(parsed.amount, Some(dec!(-4.50)));
    }

    #[test]
    fn the_first_non_blank_line_is_the_description() {
        let text = "\n\n  WALMART SUPERCENTER  \nTotal 10.00\n";
        let parsed = parse_receipt_text(text);
        assert_eq!(parsed.description, Some("WALMART SUPERCENTER".to_string()));
    }

    #[test]
    fn a_banner_line_is_trimmed_of_surrounding_punctuation() {
        let text = "*** WALMART ***\nTotal 10.00\n";
        let parsed = parse_receipt_text(text);
        assert_eq!(parsed.description, Some("WALMART".to_string()));
    }

    #[test]
    fn parses_a_us_style_slash_date() {
        let parsed = parse_receipt_text("SHOP\n08/27/2026\nTotal 10.00\n");
        assert_eq!(parsed.date, Some("2026-08-27".to_string()));
    }

    #[test]
    fn parses_an_iso_date() {
        let parsed = parse_receipt_text("SHOP\n2026-08-27\nTotal 10.00\n");
        assert_eq!(parsed.date, Some("2026-08-27".to_string()));
    }

    #[test]
    fn parses_a_month_name_date() {
        let parsed = parse_receipt_text("SHOP\nAugust 27, 2026\nTotal 10.00\n");
        assert_eq!(parsed.date, Some("2026-08-27".to_string()));
    }

    #[test]
    fn an_unparseable_date_is_none_not_a_guess() {
        let parsed = parse_receipt_text("SHOP\nThanks for visiting!\nTotal 10.00\n");
        assert_eq!(parsed.date, None);
    }

    #[test]
    fn a_refund_keyword_flips_the_amount_positive_and_sets_is_income() {
        let parsed = parse_receipt_text("REFUND\nTotal 12.00\n");
        assert_eq!(parsed.amount, Some(dec!(12.00)));
        assert!(parsed.is_income);
    }

    #[test]
    fn a_plain_receipt_defaults_to_expense() {
        let parsed = parse_receipt_text("CAFE\nTotal 12.00\n");
        assert_eq!(parsed.amount, Some(dec!(-12.00)));
        assert!(!parsed.is_income);
    }

    #[test]
    fn blank_text_returns_an_empty_draft_not_a_panic() {
        assert_eq!(parse_receipt_text(""), ParsedReceipt::default());
    }

    #[test]
    fn a_currency_symbol_and_thousands_separator_total_still_parses() {
        let parsed = parse_receipt_text("SHOP\nTOTAL S$1,234.56\n");
        assert_eq!(parsed.amount, Some(dec!(-1234.56)));
    }
}
