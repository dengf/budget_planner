//! Client-side CSV import.
//!
//! This is the module that replaces bank-linking: a person exports a
//! statement from their bank's own site and drops the file here. Parsing
//! and column interpretation happen entirely in this crate -- the only
//! host-layer step is `FileReader` reading the bytes off disk, which
//! happens in `www/` before this is ever called (see CLAUDE.md's rule on
//! where a thing goes).

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

use budget_core::BudgetError;

use crate::transaction::Transaction;

/// Which column of the CSV holds what. 0-indexed. A bank's own export
/// column order is never assumed -- the person (or a future auto-detect
/// pass) tells this module where to look.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ColumnMapping {
    pub date_col: usize,
    pub description_col: usize,
    pub amount_col: usize,
    /// Some exports split debit/credit into two columns rather than one
    /// signed amount. When set, `amount_col` is read as a positive debit
    /// and this column as a positive credit; at most one is non-empty per
    /// row.
    pub credit_col: Option<usize>,
    pub has_header: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedTransaction {
    pub transaction: Transaction,
    /// The row it came from (1-indexed, counting the header if present) --
    /// so a review screen can point back at the exact line.
    pub source_row: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ImportOutcome {
    pub imported: Vec<ImportedTransaction>,
    /// Rows that didn't parse, with why -- surfaced, never silently
    /// dropped. A row a bank pads with a running-balance footer line is a
    /// real, common shape and should show up here rather than vanish.
    pub skipped: Vec<SkippedRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkippedRow {
    pub row: usize,
    pub reason: String,
}

/// Header names `detect_columns` recognizes for each role, lowercase.
const DATE_HEADERS: [&str; 5] = [
    "date",
    "transaction date",
    "posted date",
    "trans date",
    "value date",
];
const DESCRIPTION_HEADERS: [&str; 7] = [
    "description",
    "memo",
    "payee",
    "merchant",
    "details",
    "narrative",
    "transaction description",
];
const AMOUNT_HEADERS: [&str; 3] = ["amount", "amt", "transaction amount"];
const DEBIT_HEADERS: [&str; 4] = ["debit", "withdrawal", "money out", "debit amount"];
const CREDIT_HEADERS: [&str; 4] = ["credit", "deposit", "money in", "credit amount"];

/// The first header cell (case-insensitive, trimmed) matching one of
/// `keywords`, if any.
fn find_column(headers: &[String], keywords: &[&str]) -> Option<usize> {
    headers
        .iter()
        .position(|h| keywords.contains(&h.trim().to_lowercase().as_str()))
}

/// Guesses a `ColumnMapping` from the CSV's header row, the way a person
/// reading the same row by eye would: matching common bank/card export
/// column names ("Date", "Memo", "Debit"/"Credit", ...) rather than
/// assuming a fixed column order.
fn detect_from_header(headers: &[String]) -> Option<ColumnMapping> {
    let date_col = find_column(headers, &DATE_HEADERS)?;
    let description_col = find_column(headers, &DESCRIPTION_HEADERS)?;

    if let Some(amount_col) = find_column(headers, &AMOUNT_HEADERS) {
        return Some(ColumnMapping {
            date_col,
            description_col,
            amount_col,
            credit_col: None,
            has_header: true,
        });
    }

    let debit_col = find_column(headers, &DEBIT_HEADERS)?;
    let credit_col = find_column(headers, &CREDIT_HEADERS)?;
    Some(ColumnMapping {
        date_col,
        description_col,
        amount_col: debit_col,
        credit_col: Some(credit_col),
        has_header: true,
    })
}

const CONTENT_DATE_FORMATS: [&str; 6] = [
    "%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%d/%m/%Y", "%m-%d-%Y", "%d-%m-%Y",
];

fn looks_like_a_date(raw: &str) -> bool {
    let trimmed = raw.trim();
    CONTENT_DATE_FORMATS
        .iter()
        .any(|fmt| chrono::NaiveDate::parse_from_str(trimmed, fmt).is_ok())
}

/// Deliberately narrower than `parse_amount` alone: a bare integer like
/// "10294" parses fine as a `Decimal` but is exactly as likely to be a
/// reference number as a whole-dollar amount, and unlike the header-name
/// path (which trusts a column labeled "Amount" even with no header text
/// to confirm it), content-sniffing has no such confirmation to fall
/// back on -- so it requires a decimal point or currency symbol before
/// it will call a column "money". Known, deliberate gap: a real
/// whole-dollar-only export with no header row won't be picked up by
/// this path (the header-name path still handles it fine when a header
/// exists).
fn looks_like_an_amount(raw: &str) -> bool {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return false;
    }
    let has_currency_marking = trimmed.contains('.')
        || trimmed
            .chars()
            .any(|c| !c.is_ascii_digit() && !c.is_ascii_whitespace() && c != '-');
    has_currency_marking && parse_amount(trimmed).is_some()
}

/// A real debit/credit split has, on nearly every sampled row, at most
/// one side filled -- a debit and a credit landing in the same row would
/// mean two unrelated amount-shaped columns that just happen to both
/// look like money, not an actual split pair. Not a strict 100%: the
/// sample includes row 0, which is both-filled on every genuine header
/// (its two column labels are never blank), so requiring every row would
/// make this reject the very shape it exists to recognize.
fn is_debit_credit_shaped(a: &[&str], b: &[&str]) -> bool {
    if a.is_empty() {
        return false;
    }
    let single_sided = a
        .iter()
        .zip(b)
        .filter(|(x, y)| x.trim().is_empty() || y.trim().is_empty())
        .count();
    single_sided as f64 / a.len() as f64 >= 0.8
}

/// Falls back to sniffing each column's actual values when the header
/// (if any) doesn't use a recognized name for any role -- an export in
/// another language, an unusual label, or no header row at all. Reads
/// the sample the way a person skimming unfamiliar rows would: "this
/// column's all dates," "this one's all money." A column needs a
/// majority of the sample to agree before it's trusted with a role, and
/// this bails entirely -- `None`, not a guess -- on genuine ambiguity
/// (more than one equally-plausible amount column with no debit/credit
/// shape to it, or no column that reads as a date at all).
fn detect_columns_from_content(rows: &[Vec<String>]) -> Option<ColumnMapping> {
    const MIN_MATCH_RATIO: f64 = 0.6;

    let width = rows.iter().map(Vec::len).max()?;
    if width == 0 {
        return None;
    }

    let column = |c: usize| -> Vec<&str> {
        rows.iter()
            .filter_map(|r| r.get(c))
            .map(String::as_str)
            .collect()
    };
    // A blank cell is inconclusive, not a strike against the column -- a
    // debit/credit split is *supposed* to be roughly half-empty on each
    // side, and scoring those blanks as mismatches would push a real
    // split column below the confidence threshold precisely because it's
    // shaped the way a split column should be.
    let match_ratio = |cells: &[&str], matches: fn(&str) -> bool| -> f64 {
        let non_blank: Vec<&&str> = cells.iter().filter(|c| !c.trim().is_empty()).collect();
        if non_blank.is_empty() {
            return 0.0;
        }
        non_blank.iter().filter(|c| matches(c)).count() as f64 / non_blank.len() as f64
    };

    let date_col = (0..width)
        .filter(|&c| match_ratio(&column(c), looks_like_a_date) >= MIN_MATCH_RATIO)
        .max_by(|&a, &b| {
            match_ratio(&column(a), looks_like_a_date)
                .total_cmp(&match_ratio(&column(b), looks_like_a_date))
        })?;

    let amount_candidates: Vec<usize> = (0..width)
        .filter(|&c| {
            c != date_col && match_ratio(&column(c), looks_like_an_amount) >= MIN_MATCH_RATIO
        })
        .collect();

    let (amount_col, credit_col) = match amount_candidates.as_slice() {
        [single] => (*single, None),
        [a, b] if is_debit_credit_shaped(&column(*a), &column(*b)) => (*a, Some(*b)),
        _ => return None,
    };

    let description_col = (0..width)
        .filter(|&c| c != date_col && c != amount_col && Some(c) != credit_col)
        .max_by_key(|&c| {
            let cells = column(c);
            cells.iter().map(|s| s.len()).sum::<usize>() / cells.len().max(1)
        })?;

    let first = rows.first()?;
    // A header row's cells are labels, not values, so they fail the same
    // date/amount checks that picked these columns in the first place --
    // that mismatch is the signal that row 0 should be skipped on import.
    let has_header = !first.get(date_col).is_some_and(|v| looks_like_a_date(v))
        || !first
            .get(amount_col)
            .is_some_and(|v| looks_like_an_amount(v));

    Some(ColumnMapping {
        date_col,
        description_col,
        amount_col,
        credit_col,
        has_header,
    })
}

/// Guesses a `ColumnMapping` for `csv_text`, trying the header row's
/// column names first (the common case for a real bank/card export) and
/// falling back to sniffing the data itself when that doesn't confidently
/// resolve. Returns `None` -- never a wrong guess -- when neither pass
/// can confidently place every required column; `TransactionsTab` falls
/// back to its own manual defaults in that case, so nothing is lost by
/// trying this first.
pub fn detect_columns(csv_text: &str) -> Option<ColumnMapping> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(csv_text.as_bytes());
    let rows: Vec<Vec<String>> = reader
        .records()
        .take(11) // a possible header, plus up to 10 data rows to sample
        .filter_map(|r| r.ok())
        .map(|r| r.iter().map(str::to_string).collect())
        .collect();

    let first_row = rows.first()?;
    detect_from_header(first_row).or_else(|| detect_columns_from_content(&rows))
}

/// Common thousands separators and a currency symbol prefix/suffix a bank
/// export might include even in a numeric-looking column, plus the
/// parenthesized-negative convention some accounting exports use.
pub(crate) fn parse_amount(raw: &str) -> Option<Decimal> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let negative_parens = trimmed.starts_with('(') && trimmed.ends_with(')');
    let stripped: String = trimmed
        .trim_start_matches('(')
        .trim_end_matches(')')
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
        .collect();
    let value = Decimal::from_str(&stripped).ok()?;
    Some(if negative_parens { -value.abs() } else { value })
}

/// Parses `csv_text` into transactions using `mapping`, next id assigned
/// by `next_id` (called once per successful row, in row order) so callers
/// can hand out ids however storage wants them without this module
/// depending on a clock or a random source.
pub fn import_csv(
    csv_text: &str,
    mapping: ColumnMapping,
    mut next_id: impl FnMut() -> String,
) -> Result<ImportOutcome, BudgetError> {
    // "Empty" means nothing at all, not "no data rows" -- a file with only
    // a header is a legitimate (if pointless) import of zero transactions,
    // and should not error the way a corrupted or blank drop does.
    if csv_text.trim().is_empty() {
        return Err(BudgetError::EmptyCsv);
    }

    let mut reader = csv::ReaderBuilder::new()
        .has_headers(mapping.has_header)
        .flexible(true)
        .from_reader(csv_text.as_bytes());

    let mut outcome = ImportOutcome::default();
    let header_offset = if mapping.has_header { 1 } else { 0 };
    let max_col = [
        mapping.date_col,
        mapping.description_col,
        mapping.amount_col,
    ]
    .into_iter()
    .chain(mapping.credit_col)
    .max()
    .unwrap_or(0);

    for (i, record) in reader.records().enumerate() {
        let row = i + 1 + header_offset;

        let record = match record {
            Ok(r) => r,
            Err(e) => {
                outcome.skipped.push(SkippedRow {
                    row,
                    reason: e.to_string(),
                });
                continue;
            }
        };

        if record.len() <= max_col {
            outcome.skipped.push(SkippedRow {
                row,
                reason: format!(
                    "expected at least {} columns, row has {}",
                    max_col + 1,
                    record.len()
                ),
            });
            continue;
        }

        let date = record
            .get(mapping.date_col)
            .unwrap_or("")
            .trim()
            .to_string();
        let description = record
            .get(mapping.description_col)
            .unwrap_or("")
            .trim()
            .to_string();

        let debit = record.get(mapping.amount_col).and_then(parse_amount);
        let credit = mapping
            .credit_col
            .and_then(|c| record.get(c))
            .and_then(parse_amount);

        // A signed single column reads as-is; a debit/credit pair reads a
        // debit as spending (negative) and a credit as income (positive),
        // matching Transaction's own sign convention.
        let amount = match (debit, credit, mapping.credit_col) {
            (Some(d), _, None) => d,
            (Some(d), None, Some(_)) if d.is_sign_positive() => -d,
            (Some(d), None, Some(_)) => d,
            (None, Some(c), Some(_)) => c.abs(),
            _ => {
                outcome.skipped.push(SkippedRow {
                    row,
                    reason: "could not read an amount from this row".to_string(),
                });
                continue;
            }
        };

        if date.is_empty() {
            outcome.skipped.push(SkippedRow {
                row,
                reason: "date column is blank".to_string(),
            });
            continue;
        }

        let transaction = Transaction::new(next_id(), date, description, amount);
        outcome.imported.push(ImportedTransaction {
            transaction,
            source_row: row,
        });
    }

    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn detects_a_standard_single_amount_header() {
        let m = detect_columns("Date,Description,Amount\n2026-08-01,COFFEE,-3.50\n").unwrap();
        assert_eq!(m.date_col, 0);
        assert_eq!(m.description_col, 1);
        assert_eq!(m.amount_col, 2);
        assert_eq!(m.credit_col, None);
        assert!(m.has_header);
    }

    #[test]
    fn detects_headers_in_a_different_order() {
        let m = detect_columns("Amount,Memo,Transaction Date\n").unwrap();
        assert_eq!(m.date_col, 2);
        assert_eq!(m.description_col, 1);
        assert_eq!(m.amount_col, 0);
    }

    #[test]
    fn detects_a_split_debit_credit_header() {
        let m = detect_columns("Transaction Date,Payee,Debit,Credit\n").unwrap();
        assert_eq!(m.date_col, 0);
        assert_eq!(m.description_col, 1);
        assert_eq!(m.amount_col, 2, "debit column stands in for amount_col");
        assert_eq!(m.credit_col, Some(3));
    }

    #[test]
    fn matches_headers_case_insensitively() {
        let m = detect_columns("DATE,description,AMOUNT\n").unwrap();
        assert_eq!((m.date_col, m.description_col, m.amount_col), (0, 1, 2));
    }

    #[test]
    fn gives_up_when_no_recognizable_headers_exist() {
        assert_eq!(detect_columns("Col1,Col2,Col3\n"), None);
    }

    #[test]
    fn gives_up_on_an_empty_file_rather_than_panicking() {
        assert_eq!(detect_columns(""), None);
    }

    #[test]
    fn a_missing_amount_and_debit_credit_pair_gives_up() {
        assert_eq!(detect_columns("Date,Description,Balance\n"), None);
    }

    #[test]
    fn content_sniffing_detects_columns_in_a_headerless_export() {
        let csv =
            "2026-08-01,STARBUCKS,-5.50\n2026-08-02,SALARY,3000.00\n2026-08-03,RENT,-1500.00\n";
        let m = detect_columns(csv).unwrap();
        assert_eq!(m.date_col, 0);
        assert_eq!(m.description_col, 1);
        assert_eq!(m.amount_col, 2);
        assert_eq!(m.credit_col, None);
        assert!(!m.has_header);
    }

    #[test]
    fn content_sniffing_recovers_when_header_names_are_unrecognized() {
        let csv = "Wann,Was,Betrag\n2026-08-01,KAFFEE,-3.50\n2026-08-02,GEHALT,3000.00\n2026-08-03,MIETE,-1200.00\n";
        let m = detect_columns(csv).unwrap();
        assert_eq!(m.date_col, 0);
        assert_eq!(m.description_col, 1);
        assert_eq!(m.amount_col, 2);
        assert!(
            m.has_header,
            "the header row's own cells don't look like a date or amount"
        );
    }

    #[test]
    fn content_sniffing_detects_a_debit_credit_shape() {
        // More rows than the other fixtures deliberately: a real split
        // column is only ever about half filled, so a small sample makes
        // the header row's own non-matching text a bigger fraction of
        // what's left -- exactly the shape `detect_columns`'s real 10-row
        // sample is built to be robust against.
        let csv = "Datum,Text,Soll,Haben\n\
                   2026-08-01,KAFFEE,3.50,\n\
                   2026-08-02,GEHALT,,3000.00\n\
                   2026-08-03,MIETE,1200.00,\n\
                   2026-08-04,BUS,4.00,\n\
                   2026-08-05,BONUS,,500.00\n\
                   2026-08-06,STROM,89.00,\n";
        let m = detect_columns(csv).unwrap();
        assert_eq!(m.amount_col, 2);
        assert_eq!(m.credit_col, Some(3));
    }

    #[test]
    fn a_plain_reference_number_column_is_not_mistaken_for_an_amount() {
        let csv = "Wann,Was,Ref,Betrag\n2026-08-01,KAFFEE,10293,-3.50\n2026-08-02,GEHALT,10294,3000.00\n2026-08-03,MIETE,10295,-1200.00\n";
        let m = detect_columns(csv).unwrap();
        assert_eq!(m.amount_col, 3);
    }

    #[test]
    fn genuinely_ambiguous_content_still_gives_up() {
        // Two columns that both look like independent amounts on the same
        // rows, not a debit/credit shape -- no confident single guess.
        let csv = "Wann,Was,A,B\n2026-08-01,X,3.50,7.25\n2026-08-02,Y,4.10,8.00\n2026-08-03,Z,5.00,9.99\n";
        assert_eq!(detect_columns(csv), None);
    }

    fn ids() -> impl FnMut() -> String {
        let mut n = 0;
        move || {
            n += 1;
            format!("t{n}")
        }
    }

    fn mapping() -> ColumnMapping {
        ColumnMapping {
            date_col: 0,
            description_col: 1,
            amount_col: 2,
            credit_col: None,
            has_header: true,
        }
    }

    #[test]
    fn parses_a_plain_signed_amount_export() {
        let csv =
            "Date,Description,Amount\n2026-08-01,STARBUCKS,-5.50\n2026-08-02,SALARY,3000.00\n";
        let outcome = import_csv(csv, mapping(), ids()).unwrap();
        assert_eq!(outcome.imported.len(), 2);
        assert_eq!(outcome.imported[0].transaction.amount, dec!(-5.50));
        assert_eq!(outcome.imported[1].transaction.amount, dec!(3000.00));
    }

    #[test]
    fn handles_a_currency_symbol_and_thousands_separator() {
        let csv = "Date,Description,Amount\n2026-08-01,RENT,\"-S$2,000.00\"\n";
        let outcome = import_csv(csv, mapping(), ids()).unwrap();
        assert_eq!(outcome.imported[0].transaction.amount, dec!(-2000.00));
    }

    #[test]
    fn treats_a_parenthesized_amount_as_negative() {
        let csv = "Date,Description,Amount\n2026-08-01,FEE,\"(4.95)\"\n";
        let outcome = import_csv(csv, mapping(), ids()).unwrap();
        assert_eq!(outcome.imported[0].transaction.amount, dec!(-4.95));
    }

    #[test]
    fn a_debit_credit_pair_reads_as_one_signed_amount() {
        let m = ColumnMapping {
            date_col: 0,
            description_col: 1,
            amount_col: 2,
            credit_col: Some(3),
            has_header: true,
        };
        let csv = "Date,Desc,Debit,Credit\n2026-08-01,COFFEE,3.50,\n2026-08-02,SALARY,,3000.00\n";
        let outcome = import_csv(csv, m, ids()).unwrap();
        assert_eq!(outcome.imported[0].transaction.amount, dec!(-3.50));
        assert_eq!(outcome.imported[1].transaction.amount, dec!(3000.00));
    }

    #[test]
    fn a_short_footer_row_is_skipped_not_fatal() {
        let csv = "Date,Description,Amount\n2026-08-01,COFFEE,-3.50\nEnding balance: 500.00\n";
        let outcome = import_csv(csv, mapping(), ids()).unwrap();
        assert_eq!(outcome.imported.len(), 1);
        assert_eq!(outcome.skipped.len(), 1);
        assert_eq!(outcome.skipped[0].row, 3);
    }

    #[test]
    fn a_blank_date_is_skipped_with_a_reason() {
        let csv = "Date,Description,Amount\n,COFFEE,-3.50\n";
        let outcome = import_csv(csv, mapping(), ids()).unwrap();
        assert_eq!(outcome.imported.len(), 0);
        assert!(outcome.skipped[0].reason.contains("date"));
    }

    #[test]
    fn a_csv_with_only_a_header_is_empty_not_an_error() {
        let csv = "Date,Description,Amount\n";
        let outcome = import_csv(csv, mapping(), ids()).unwrap();
        assert_eq!(outcome.imported.len(), 0);
        assert_eq!(outcome.skipped.len(), 0);
    }

    #[test]
    fn a_genuinely_empty_file_is_an_error() {
        let err = import_csv("", mapping(), ids()).unwrap_err();
        assert_eq!(err, BudgetError::EmptyCsv);
    }

    #[test]
    fn row_numbers_account_for_the_header() {
        let csv = "Date,Description,Amount\n2026-08-01,COFFEE,-3.50\n";
        let outcome = import_csv(csv, mapping(), ids()).unwrap();
        assert_eq!(outcome.imported[0].source_row, 2);
    }
}
