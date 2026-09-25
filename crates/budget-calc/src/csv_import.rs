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
    /// Which date convention the whole file was read under, as a pattern a
    /// person can check ("DD/MM/YYYY"). Surfaced because `03/08/2026` is
    /// genuinely ambiguous and this module has to pick one reading of it --
    /// a review line naming the pick is the difference between a guess the
    /// person can catch and one that silently files August as March.
    pub date_format: Option<String>,
}

/// One column of the file as a person picking it out of a menu would see
/// it, rather than as a number they have to count commas to find.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CsvColumn {
    pub index: usize,
    /// The header cell, when the file has a header row.
    pub header: Option<String>,
    /// The first non-blank value below the header -- what makes a column
    /// recognizable when its label is missing, unhelpful, or in a language
    /// `DATE_HEADERS` and friends below don't list.
    pub sample: Option<String>,
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

/// Every date shape this module recognizes -- used both to sniff which
/// column holds the dates and to normalize the ones it reads, so the two
/// can never drift into "detected it, then couldn't import it".
///
/// Day-first before month-first, deliberately, the same order and for the
/// same reason as `receipt::NUMERIC_DATE_FORMATS`: a date whose halves are
/// both <= 12 ("03/08/2026") is genuinely ambiguous, and the
/// international convention is the better default for this app's
/// userbase. An unambiguous date resolves the same way whichever comes
/// first.
const DATE_FORMATS: [&str; 14] = [
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%d/%m/%Y",
    "%m/%d/%Y",
    "%d-%m-%Y",
    "%m-%d-%Y",
    "%d/%m/%y",
    "%m/%d/%y",
    "%d-%m-%y",
    "%m-%d-%y",
    "%d %B %Y",
    "%d %b %Y",
    "%B %d, %Y",
    "%b %d, %Y",
];

/// One date under one format, with the four-digit-year formats held to
/// four digits.
///
/// chrono's `%Y` takes however many digits it is given, so `%Y/%m/%d`
/// happily reads `15/09/26` as the year 15 -- and since that format sits
/// ahead of `%d/%m/%y` in `DATE_FORMATS`, it used to win the tie and file
/// a whole `DD/MM/YY` statement under the year 0015, which is in no
/// month this app can show. A year is either written out in full or it
/// isn't, so requiring the full four digits is the actual rule rather
/// than a guess at which years are plausible.
fn parse_date_with(raw: &str, fmt: &str) -> Option<chrono::NaiveDate> {
    let date = chrono::NaiveDate::parse_from_str(raw.trim(), fmt).ok()?;
    if fmt.contains("%Y") && !(1000..=9999).contains(&chrono::Datelike::year(&date)) {
        return None;
    }
    Some(date)
}

fn looks_like_a_date(raw: &str) -> bool {
    DATE_FORMATS
        .iter()
        .any(|fmt| parse_date_with(raw, fmt).is_some())
}

/// The one format the whole file's dates are read under.
///
/// Resolved per file rather than per row on purpose. Letting each row pick
/// its own best match is how `09/24/2026` and `03/08/2026` in the same
/// statement end up read as September and March -- the second one silently
/// wrong by five months, because nothing in that row alone says which half
/// is the day. One bank writes one convention, so the whole column votes:
/// the format that reads the most of the sampled dates wins, which makes a
/// single unambiguous `24/09/2026` anywhere in the column settle the
/// reading of every other row in it.
fn resolve_date_format(dates: &[String]) -> Option<&'static str> {
    let mut best: Option<(&'static str, usize)> = None;
    for fmt in DATE_FORMATS {
        let hits = dates
            .iter()
            .filter(|d| parse_date_with(d, fmt).is_some())
            .count();
        // Strictly greater, so a tie keeps the earlier format -- which is
        // what makes `DATE_FORMATS`' day-first ordering the tie-break for a
        // file where every date is ambiguous.
        if hits > 0 && best.is_none_or(|(_, most)| hits > most) {
            best = Some((fmt, hits));
        }
    }
    best.map(|(fmt, _)| fmt)
}

/// A `strftime` pattern as the shape a person reads it as, for the review
/// line that says how the dates were taken.
fn human_date_format(fmt: &str) -> String {
    fmt.replace("%Y", "YYYY")
        .replace("%y", "YY")
        .replace("%m", "MM")
        .replace("%d", "DD")
        .replace("%B", "Month")
        .replace("%b", "Mon")
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
    // A possible header, plus up to 10 data rows to sample.
    let rows = sample_rows(csv_text, 11);
    let first_row = rows.first()?;
    detect_from_header(first_row).or_else(|| detect_columns_from_content(&rows))
}

/// The first `limit` rows, cells trimmed of nothing and kept as-is -- every
/// caller here reads rows the same way, and a second copy of this reader
/// setup is a second place for `flexible(true)` to go missing.
fn sample_rows(csv_text: &str, limit: usize) -> Vec<Vec<String>> {
    csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(csv_text.as_bytes())
        .records()
        .take(limit)
        .filter_map(Result::ok)
        .map(|r| r.iter().map(str::to_string).collect())
        .collect()
}

/// The file's columns, labelled the way a person would recognize them, for
/// a "which column is which" picker.
///
/// Exists because the only thing a UI can otherwise ask for is a column
/// *number*, which means counting separators in a file the person is not
/// looking at -- and a mis-picked column doesn't announce itself, it just
/// skips or mis-reads rows. `has_header` decides whether row 0 is a set of
/// labels or the first set of values; it's the caller's own mapping flag,
/// so the picker and the import can't disagree about it.
pub fn preview_columns(csv_text: &str, has_header: bool) -> Vec<CsvColumn> {
    let rows = sample_rows(csv_text, 6);
    let width = rows.iter().map(Vec::len).max().unwrap_or(0);
    let skip = usize::from(has_header);

    (0..width)
        .map(|index| {
            let cell = |row: &Vec<String>| {
                row.get(index)
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
            };
            CsvColumn {
                index,
                header: if has_header {
                    rows.first().and_then(cell)
                } else {
                    None
                },
                sample: rows.iter().skip(skip).find_map(cell),
            }
        })
        .collect()
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

    // The date column read once, before a single row is imported, so every
    // row is taken under one convention -- see `resolve_date_format`. Cheap:
    // the whole file is already in memory, this is a second walk over it.
    let date_format = resolve_date_format(
        &sample_rows(csv_text, usize::MAX)
            .into_iter()
            .skip(usize::from(mapping.has_header))
            .filter_map(|row| row.get(mapping.date_col).cloned())
            .collect::<Vec<String>>(),
    );

    let mut outcome = ImportOutcome {
        date_format: date_format.map(human_date_format),
        ..Default::default()
    };
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
            (Some(d), None, Some(_)) if d.is_sign_positive() => -d,
            (Some(d), _, None) | (Some(d), None, Some(_)) => d,
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

        // Stored ISO, always. Every month view in the app filters on a
        // `YYYY-MM` prefix of this string, so a date left in the file's own
        // `09/24/2026` form imports "successfully", counts towards the
        // imported total, and then appears on no screen in the app -- the
        // worst shape a bug can take here, since the person is told it
        // worked. A date no recognized format reads is skipped and surfaced
        // rather than stored in a form nothing can use.
        let Some(date) = date_format
            .and_then(|fmt| parse_date_with(&date, fmt))
            .map(|d| d.format("%Y-%m-%d").to_string())
        else {
            outcome.skipped.push(SkippedRow {
                row,
                reason: format!("could not read a date from \"{date}\""),
            });
            continue;
        };

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

    #[test]
    fn stores_a_slash_date_as_iso_so_the_month_views_can_find_it() {
        // The whole point. Every month view in the app filters on a
        // `YYYY-MM` prefix, so before this the rows below imported, counted
        // as a success, and showed up nowhere.
        let csv = "Date,Description,Amount\n09/24/2026,COFFEE,-4.50\n09/23/2026,PAYCHECK,2000.00\n";
        let outcome = import_csv(csv, mapping(), ids()).unwrap();
        assert_eq!(outcome.skipped.len(), 0);
        assert_eq!(outcome.imported[0].transaction.date, "2026-09-24");
        assert_eq!(outcome.imported[1].transaction.date, "2026-09-23");
        assert!(outcome
            .imported
            .iter()
            .all(|i| i.transaction.date.starts_with("2026-09")));
    }

    #[test]
    fn an_iso_export_is_left_exactly_as_it_was() {
        let csv = "Date,Description,Amount\n2026-08-01,STARBUCKS,-5.50\n";
        let outcome = import_csv(csv, mapping(), ids()).unwrap();
        assert_eq!(outcome.imported[0].transaction.date, "2026-08-01");
        assert_eq!(outcome.date_format.as_deref(), Some("YYYY-MM-DD"));
    }

    #[test]
    fn one_unambiguous_row_settles_the_day_month_order_for_the_whole_file() {
        // Row 2 is ambiguous on its own -- 03/08 could be either order. Row
        // 1 cannot be month-first (there is no month 24), and one bank
        // writes one convention, so row 2 is read day-first with it. Read
        // row by row, row 2 would come out as March 8th instead.
        let csv = "Date,Description,Amount\n24/09/2026,COFFEE,-4.50\n03/08/2026,RENT,-2000.00\n";
        let outcome = import_csv(csv, mapping(), ids()).unwrap();
        assert_eq!(outcome.imported[0].transaction.date, "2026-09-24");
        assert_eq!(outcome.imported[1].transaction.date, "2026-08-03");
        assert_eq!(outcome.date_format.as_deref(), Some("DD/MM/YYYY"));
    }

    #[test]
    fn the_same_file_written_month_first_resolves_the_other_way() {
        let csv = "Date,Description,Amount\n09/24/2026,COFFEE,-4.50\n08/03/2026,RENT,-2000.00\n";
        let outcome = import_csv(csv, mapping(), ids()).unwrap();
        assert_eq!(outcome.imported[1].transaction.date, "2026-08-03");
        assert_eq!(outcome.date_format.as_deref(), Some("MM/DD/YYYY"));
    }

    #[test]
    fn a_file_of_only_ambiguous_dates_reads_day_first_and_says_so() {
        // Nothing in the file can settle it, so this falls back to the
        // international reading -- the same default `receipt.rs` takes --
        // and reports it, which is what gives the person a chance to catch
        // a US export that needed the other one.
        let csv = "Date,Description,Amount\n03/08/2026,RENT,-2000.00\n05/06/2026,COFFEE,-4.50\n";
        let outcome = import_csv(csv, mapping(), ids()).unwrap();
        assert_eq!(outcome.imported[0].transaction.date, "2026-08-03");
        assert_eq!(outcome.date_format.as_deref(), Some("DD/MM/YYYY"));
    }

    #[test]
    fn a_two_digit_year_is_not_read_as_the_year_fifteen() {
        // `%Y` will take two digits if offered them, so `%Y/%m/%d` used to
        // claim this file and store 0015-09-26 -- a row that then appeared
        // in no month view at all, which is the exact failure normalising
        // the dates was meant to end.
        let csv = "Date,Description,Amount\n15/09/26,BUS FARE,-2.10\n02/09/26,MRT,-1.50\n";
        let outcome = import_csv(csv, mapping(), ids()).unwrap();
        assert_eq!(outcome.date_format.as_deref(), Some("DD/MM/YY"));
        assert_eq!(outcome.imported[0].transaction.date, "2026-09-15");
        assert_eq!(outcome.imported[1].transaction.date, "2026-09-02");
        assert!(outcome.skipped.is_empty());
    }

    #[test]
    fn a_two_digit_year_written_with_dashes_reads_the_same_way() {
        let csv = "Date,Description,Amount\n15-09-26,BUS FARE,-2.10\n";
        let outcome = import_csv(csv, mapping(), ids()).unwrap();
        assert_eq!(outcome.date_format.as_deref(), Some("DD-MM-YY"));
        assert_eq!(outcome.imported[0].transaction.date, "2026-09-15");
    }

    #[test]
    fn a_four_digit_year_still_wins_where_it_is_actually_written_out() {
        // The guard must not cost the ISO path anything.
        let csv = "Date,Description,Amount\n2026/09/15,BUS FARE,-2.10\n";
        let outcome = import_csv(csv, mapping(), ids()).unwrap();
        assert_eq!(outcome.date_format.as_deref(), Some("YYYY/MM/DD"));
        assert_eq!(outcome.imported[0].transaction.date, "2026-09-15");
    }

    #[test]
    fn reads_a_written_out_month_name() {
        let csv = "Date,Description,Amount\n\"24 Sep 2026\",COFFEE,-4.50\n";
        let outcome = import_csv(csv, mapping(), ids()).unwrap();
        assert_eq!(outcome.imported[0].transaction.date, "2026-09-24");
    }

    #[test]
    fn a_date_no_format_reads_is_skipped_rather_than_stored_unusable() {
        let csv = "Date,Description,Amount\n2026-08-01,COFFEE,-4.50\nlast Tuesday,RENT,-2000.00\n";
        let outcome = import_csv(csv, mapping(), ids()).unwrap();
        assert_eq!(outcome.imported.len(), 1);
        assert_eq!(outcome.skipped.len(), 1);
        assert_eq!(outcome.skipped[0].row, 3);
        assert!(
            outcome.skipped[0].reason.contains("last Tuesday"),
            "the reason should name the cell it could not read: {:?}",
            outcome.skipped[0].reason
        );
    }

    #[test]
    fn column_preview_labels_each_column_with_its_header_and_first_value() {
        let csv = "Date,Description,Amount\n2026-08-01,STARBUCKS,-5.50\n";
        let columns = preview_columns(csv, true);
        assert_eq!(columns.len(), 3);
        assert_eq!(columns[1].index, 1);
        assert_eq!(columns[1].header.as_deref(), Some("Description"));
        assert_eq!(columns[1].sample.as_deref(), Some("STARBUCKS"));
    }

    #[test]
    fn column_preview_takes_the_first_value_below_a_blank_cell() {
        // A debit/credit split is half-empty by design, so the first row
        // under the header is exactly where a sample is likely to be blank.
        let csv = "Date,Payee,Debit,Credit\n2026-08-01,COFFEE,4.50,\n2026-08-02,SALARY,,3000.00\n";
        let columns = preview_columns(csv, true);
        assert_eq!(columns[3].header.as_deref(), Some("Credit"));
        assert_eq!(columns[3].sample.as_deref(), Some("3000.00"));
    }

    #[test]
    fn column_preview_on_a_headerless_file_offers_values_and_no_labels() {
        let csv = "2026-08-01,STARBUCKS,-5.50\n";
        let columns = preview_columns(csv, false);
        assert_eq!(columns[0].header, None);
        assert_eq!(columns[0].sample.as_deref(), Some("2026-08-01"));
    }

    #[test]
    fn column_preview_of_an_empty_file_is_empty_not_a_panic() {
        assert_eq!(preview_columns("", true), Vec::new());
    }
}
