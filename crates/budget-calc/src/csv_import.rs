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
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
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

/// Common thousands separators and a currency symbol prefix/suffix a bank
/// export might include even in a numeric-looking column, plus the
/// parenthesized-negative convention some accounting exports use.
fn parse_amount(raw: &str) -> Option<Decimal> {
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
