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

const TOTAL_KEYWORDS: [&str; 5] = ["total", "amount due", "balance due", "总计", "合计"];
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

/// Money-like runs anywhere in the line: a maximal run of ASCII digits,
/// `,`, and `.`, kept only if it contains a `.` -- that excludes bare
/// item counts, receipt/order numbers, and phone numbers, at the cost of
/// a known v1 gap: whole-dollar totals with no cents don't match. The
/// mandatory review step, not this heuristic, is what catches that. A
/// run immediately wrapped in `(`...`)` is passed through with its
/// parens intact so `parse_amount`'s own negative-parens handling fires.
///
/// Scans the raw line rather than `line.split_whitespace()` (the
/// original approach): CJK text has no space between a price and the
/// surrounding item name/unit/currency character, so splitting on
/// whitespace treated an entire CJK line as one "word" -- concretely,
/// digit-filtering the whole line "鸡胸肉-500克6.75元" end to end used to
/// concatenate an unrelated quantity and a stray OCR-artifact hyphen into
/// the price, producing "-5006.75" instead of "6.75". Scanning for
/// contiguous digit runs instead treats each number on the line as its
/// own token regardless of what script surrounds it, and still passes
/// every existing whitespace-separated case (English receipts, "S$"
/// currency prefixes) the same way.
fn extract_amounts(line: &str) -> Vec<Decimal> {
    let chars: Vec<char> = line.chars().collect();
    let mut amounts = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if !chars[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let start = i;
        while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == ',' || chars[i] == '.') {
            i += 1;
        }
        let mut end = i;
        while end > start && matches!(chars[end - 1], '.' | ',') {
            end -= 1;
        }
        if !chars[start..end].contains(&'.') {
            continue;
        }
        let token: String = chars[start..end].iter().collect();
        let wrapped_in_parens =
            start > 0 && chars[start - 1] == '(' && end < chars.len() && chars[end] == ')';
        let token = if wrapped_in_parens {
            format!("({token})")
        } else {
            token
        };
        if let Some(amount) = parse_amount(&token) {
            amounts.push(amount.abs());
        }
    }
    amounts
}

/// The last line matching a total-keyword (never "subtotal") that yields
/// at least one money-like token -- "last" so a genuine bottom-of-receipt
/// "TOTAL $48.60" wins over an earlier, unrelated line containing the
/// same word.
fn find_total(lines: &[&str]) -> Option<Decimal> {
    let mut found = None;
    for line in lines {
        let lower = line.to_lowercase();
        if lower.contains("subtotal") || lower.contains("小计") {
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
    lines.iter().find_map(|line| find_date_token(line).map(|(_, date)| date))
}

/// The first date-shaped token in a single line, as both its raw source
/// text (so a caller can strip exactly that substring back out, e.g. from
/// a description) and its normalized ISO form. Factored out of `find_date`
/// so `parse_statement_line` can reuse the identical per-line matching
/// instead of a second, drifting copy of the same format list.
fn find_date_token(line: &str) -> Option<(String, String)> {
    use chrono::NaiveDate;

    let words: Vec<&str> = line.split_whitespace().collect();
    for w in &words {
        let cleaned = w.trim_matches(|c: char| c == ',' || c == ':');
        for fmt in NUMERIC_DATE_FORMATS {
            if let Ok(d) = NaiveDate::parse_from_str(cleaned, fmt) {
                return Some((w.to_string(), d.format("%Y-%m-%d").to_string()));
            }
        }
    }
    for window in words.windows(3) {
        let joined = window.join(" ");
        let cleaned = joined.trim_matches(|c: char| c == ',');
        for fmt in NAMED_DATE_FORMATS {
            if let Ok(d) = NaiveDate::parse_from_str(cleaned, fmt) {
                return Some((joined.clone(), d.format("%Y-%m-%d").to_string()));
            }
        }
    }
    None
}

/// One line of a multi-transaction statement (a bank/card PDF export),
/// as opposed to `ParsedReceipt`'s single total -- see `parse_statement_text`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StatementRow {
    /// 1-indexed source line, so a review list can point back at the
    /// original text the way `csv_import::ImportedTransaction::source_row`
    /// already does for a CSV row.
    pub line: usize,
    pub date: String,
    pub description: Option<String>,
    /// Signed like `Transaction::amount`. Always a guess, always reviewed
    /// before saving -- same contract as `ParsedReceipt::amount`.
    pub amount: Decimal,
    pub is_income: bool,
}

/// Splits a bank/card statement's extracted text into one row per
/// transaction line, instead of `parse_receipt_text`'s single total --
/// see that function's doc comment for why a receipt is deliberately
/// collapsed to one figure. A statement has no such single "total" to
/// anchor on; each line that looks like `date … description … amount`
/// (in that order, a bank's own printed column order) becomes a
/// candidate row. A line missing either a date or a money-like amount
/// is silently not a transaction line -- a header, a running-balance
/// footer, page furniture -- and is left out rather than guessed at.
///
/// Known v1 gap, same shape as `csv_import`'s: a PDF that lost its
/// column structure in extraction (so date/description/amount are no
/// longer reliably ordered per line, or a description happens to itself
/// contain a date-shaped or money-shaped token) can misparse a row. The
/// caller never auto-saves this -- every row lands in an editable review
/// list first, exactly like a single receipt's draft.
pub fn parse_statement_text(text: &str) -> Vec<StatementRow> {
    text.lines()
        .enumerate()
        .filter_map(|(i, line)| parse_statement_line(i + 1, line))
        .collect()
}

/// Summary/footer lines that legitimately contain both a date and a
/// money-shaped number but are not themselves a transaction -- a running
/// balance, a subtotal, a statement-level total. Skipping these by
/// keyword is the same trade CLAUDE.md's `find_total` already makes for
/// "subtotal" on a single receipt: an actual merchant named "Total Wine"
/// on a statement line is a rarer miss than a Balance/Total footer line
/// being mistaken for spend, and a missed row is always fixable by hand
/// afterward -- nothing here silently overwrites a number.
const STATEMENT_SKIP_KEYWORDS: [&str; 4] = ["balance", "subtotal", "total", "小计"];

fn parse_statement_line(line_no: usize, raw: &str) -> Option<StatementRow> {
    let line = raw.trim();
    if line.is_empty() {
        return None;
    }
    let lower = line.to_lowercase();
    if STATEMENT_SKIP_KEYWORDS.iter().any(|k| lower.contains(k)) {
        return None;
    }

    let (date_token, date) = find_date_token(line)?;
    let (amount_start, amount_end, magnitude, had_explicit_sign) = find_statement_amount(line)?;

    let is_income_line = INCOME_KEYWORDS.iter().any(|k| lower.contains(k));
    let amount = if had_explicit_sign {
        magnitude
    } else if is_income_line {
        magnitude.abs()
    } else {
        -magnitude.abs()
    };

    let chars: Vec<char> = line.chars().collect();
    let mut without_amount = chars;
    without_amount.drain(amount_start..amount_end);
    let without_amount: String = without_amount.into_iter().collect();
    let description = without_amount
        .replacen(&date_token, "", 1)
        .trim_matches(|c: char| !c.is_alphanumeric())
        .trim()
        .chars()
        .take(80)
        .collect::<String>();

    Some(StatementRow {
        line: line_no,
        date,
        description: if description.is_empty() {
            None
        } else {
            Some(description)
        },
        amount,
        is_income: amount.is_sign_positive(),
    })
}

/// The last money-like run in a line, as its character span (so the
/// caller can strip exactly that substring out of the description) and
/// signed value. A run is widened one character left to catch a leading
/// `+`/`-` sign or, when the whole run is `(`...`)`-wrapped, both
/// parens -- mirroring `extract_amounts`'s own paren handling -- so
/// `had_explicit_sign` can tell a written sign apart from a bare
/// magnitude with no direction of its own. "Last" rather than "largest"
/// (`extract_amounts`'s choice for a receipt's total): a statement's
/// own printed column order puts the amount after the date and
/// description, and a fee or tax figure earlier in the same line should
/// not outrank it just for being bigger.
fn find_statement_amount(line: &str) -> Option<(usize, usize, Decimal, bool)> {
    let chars: Vec<char> = line.chars().collect();
    let mut found = None;
    let mut i = 0;
    while i < chars.len() {
        if !chars[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let digit_start = i;
        while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == ',' || chars[i] == '.') {
            i += 1;
        }
        let mut digit_end = i;
        while digit_end > digit_start && matches!(chars[digit_end - 1], '.' | ',') {
            digit_end -= 1;
        }
        if !chars[digit_start..digit_end].contains(&'.') {
            continue;
        }
        let wrapped_in_parens = digit_start > 0
            && chars[digit_start - 1] == '('
            && digit_end < chars.len()
            && chars[digit_end] == ')';
        let (start, end, had_explicit_sign) = if wrapped_in_parens {
            (digit_start - 1, digit_end + 1, true)
        } else if digit_start > 0 && matches!(chars[digit_start - 1], '-' | '+') {
            (digit_start - 1, digit_end, true)
        } else {
            (digit_start, digit_end, false)
        };
        let token: String = chars[start..end].iter().collect();
        if let Some(amount) = parse_amount(&token) {
            found = Some((start, end, amount, had_explicit_sign));
        }
    }
    found
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

    #[test]
    fn a_chinese_total_line_wins_over_a_chinese_subtotal_line() {
        let text = "新鲜超市\n小计21.55元\n总计23.49元\n";
        let parsed = parse_receipt_text(text);
        assert_eq!(parsed.amount, Some(dec!(-23.49)));
    }

    #[test]
    fn a_price_with_no_surrounding_whitespace_does_not_absorb_a_neighboring_quantity() {
        // Real OCR output over a CJK receipt: no space between an item's
        // unit count, a stray recognition artifact ("-"), and its price.
        // A whitespace-based tokenizer used to digit-filter the entire
        // line into one number, producing "-5006.75" out of "500" (the
        // gram count) and "6.75" (the actual price).
        let parsed = parse_receipt_text("鸡胸肉-500克6.75元\n总计6.75元\n");
        assert_eq!(parsed.amount, Some(dec!(-6.75)));
    }

    #[test]
    fn an_english_price_glued_to_its_item_name_is_not_corrupted_by_a_quantity() {
        // PP-OCRv6_tiny (the model swapped in for CJK support) routinely
        // drops the space between an English item's name/unit and its
        // price -- "Milk 1L $3.20" comes back as "Milk 1L$3.20" -- unlike
        // the original ocrs models. No total line here, so this exercises
        // the largest_amount fallback directly.
        let parsed = parse_receipt_text("CAFE\nMilk 1L$3.20\n");
        assert_eq!(parsed.amount, Some(dec!(-3.20)));
    }

    #[test]
    fn a_realistic_ppocrv6_receipt_with_glued_item_prices_still_finds_the_correct_total() {
        // Actual PP-OCRv6_tiny output over a photographed English
        // receipt (from the OCR-engine spike): every item line has its
        // price glued directly to the item text with no space, and a
        // few characters are misrecognized (0/e, i/1, g/q) -- none of
        // that should stop the TOTAL line's own amount from winning.
        let text = "ERESHMART GROCERY\n\
                     123 Orchard Road, Singapore\n\
                     M1k1L$3.2e\n\
                     Wholemeal Bread$2.8e\n\
                     Eggs (12pk$4.50\n\
                     Banana s 1kq$1.90\n\
                     Chicken Breast 500a $6.75\n\
                     D1sh S0ap$2.46\n\
                     SUBTOTAL$21.55\n\
                     GST 9%$1.94\n\
                     TOTAL$23.49\n\
                     VISA****4821\n\
                     27/08/2026 18:42\n\
                     THANKYOUFOR SHOPPTNG\n";
        let parsed = parse_receipt_text(text);
        assert_eq!(parsed.amount, Some(dec!(-23.49)));
    }

    #[test]
    fn a_statement_with_several_lines_yields_one_row_per_transaction() {
        let text = "05/01/2026 STARBUCKS -4.50\n\
                     05/02/2026 SALARY DEPOSIT +3000.00\n\
                     05/03/2026 RENT -1500.00\n";
        let rows = parse_statement_text(text);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].date, "2026-05-01");
        assert_eq!(rows[0].amount, dec!(-4.50));
        assert_eq!(rows[0].description, Some("STARBUCKS".to_string()));
        assert_eq!(rows[1].amount, dec!(3000.00));
        assert_eq!(rows[2].amount, dec!(-1500.00));
    }

    #[test]
    fn an_explicit_minus_sign_is_kept_even_with_no_income_keyword() {
        let rows = parse_statement_text("05/01/2026 COFFEE SHOP -4.50\n");
        assert_eq!(rows[0].amount, dec!(-4.50));
        assert!(!rows[0].is_income);
    }

    #[test]
    fn an_unsigned_amount_defaults_to_an_expense() {
        let rows = parse_statement_text("05/01/2026 COFFEE SHOP 4.50\n");
        assert_eq!(rows[0].amount, dec!(-4.50));
    }

    #[test]
    fn an_unsigned_amount_on_an_income_keyword_line_becomes_positive() {
        let rows = parse_statement_text("05/01/2026 REFUND FROM STORE 4.50\n");
        assert_eq!(rows[0].amount, dec!(4.50));
        assert!(rows[0].is_income);
    }

    #[test]
    fn a_parenthesized_amount_stays_negative_even_on_an_income_keyword_line() {
        let rows = parse_statement_text("05/01/2026 CREDIT ADJUSTMENT (4.50)\n");
        assert_eq!(rows[0].amount, dec!(-4.50));
    }

    #[test]
    fn a_line_with_no_date_is_not_a_transaction_row() {
        let rows = parse_statement_text("Thanks for banking with us -4.50\n");
        assert!(rows.is_empty());
    }

    #[test]
    fn a_line_with_no_amount_is_not_a_transaction_row() {
        let rows = parse_statement_text("05/01/2026 Account summary\n");
        assert!(rows.is_empty());
    }

    #[test]
    fn a_balance_footer_line_is_skipped_despite_having_a_date_and_an_amount() {
        let rows = parse_statement_text(
            "05/01/2026 STARBUCKS -4.50\n05/01/2026 Ending balance 1234.56\n",
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].description, Some("STARBUCKS".to_string()));
    }

    #[test]
    fn blank_lines_are_skipped_and_line_numbers_stay_one_indexed_from_the_source() {
        let rows = parse_statement_text("\n05/01/2026 STARBUCKS -4.50\n\n");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].line, 2);
    }

    #[test]
    fn empty_statement_text_returns_no_rows_not_a_panic() {
        assert!(parse_statement_text("").is_empty());
    }
}
