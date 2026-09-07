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

/// Reference phrases for `classify_by_similarity` -- example descriptions
/// an embedding model (loaded and run by `budget-wasm-llm`, never here;
/// this crate stays free of that dependency) embeds once and compares a
/// `StatementRow` with `direction_is_guessed: true` against by cosine
/// similarity, nearest-neighbor style. This is the one place both sides
/// of that classifier's vocabulary live, so the comparison logic
/// (`classify_by_similarity`) and the phrases it was tuned against never
/// drift apart the way they would if a caller had to keep its own copy
/// in sync.
pub const INCOME_EXAMPLE_PHRASES: &[&str] = &[
    "SALARY PAYMENT",
    "PAYROLL DEPOSIT",
    "MONTHLY SALARY CREDIT",
    "INTEREST EARNED",
    "DIVIDEND PAYMENT",
    "TRANSFER RECEIVED FROM",
    "REFUND RECEIVED",
    "CASHBACK REWARD",
    "BONUS PAYMENT",
    "PENSION PAYMENT",
];
pub const EXPENSE_EXAMPLE_PHRASES: &[&str] = &[
    "GROCERY STORE PURCHASE",
    "RESTAURANT BILL",
    "ONLINE SHOPPING PURCHASE",
    "SUBSCRIPTION FEE",
    "UTILITY BILL PAYMENT",
    "TRANSPORT FARE",
    "COFFEE SHOP PURCHASE",
    "FUEL PAYMENT",
    "INSURANCE PREMIUM",
    "LOAN REPAYMENT",
    "FOOD DELIVERY APP PAYMENT",
    "RIDE HAILING FARE",
    "CAR PARK PAYMENT",
];

/// `true` (income) when a description's best cosine-similarity match
/// among `INCOME_EXAMPLE_PHRASES` beats its best match among
/// `EXPENSE_EXAMPLE_PHRASES`, `false` otherwise -- nearest-neighbor over
/// two fixed example sets rather than any model-specific logic, so this
/// stays plain, dependency-free comparison and the actual embedding
/// happens entirely in `budget-wasm-llm`. Ties favor expense, matching
/// `resolve_statement_amount`'s own default-to-expense fallback.
pub fn classify_by_similarity(best_income_similarity: f32, best_expense_similarity: f32) -> bool {
    best_income_similarity > best_expense_similarity
}

// Day-first tried before month-first: a genuinely ambiguous numeric date
// (both halves <= 12, e.g. "03/08/2026") is read as day/month, matching
// the international/SG convention most of this app's userbase uses, not
// US month/day. An unambiguous date still resolves correctly either way
// -- "08/27/2026" fails the day-first attempt (27 is not a valid month)
// and falls through to month-first, same as before this reordering.
const NUMERIC_DATE_FORMATS: [&str; 8] = [
    "%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%m-%d-%Y", "%d/%m/%y", "%m/%d/%y",
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
    lines
        .iter()
        .find_map(|line| find_date_token(line).map(|(_, date)| date))
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
    /// `true` only when `amount`'s direction came from the last-resort
    /// default (no explicit sign, no `CR`/`DB` marker, no
    /// `INCOME_KEYWORDS` hit) -- see `resolve_statement_amount`. Lets a
    /// caller single out exactly the rows worth spending an optional,
    /// heavier classification pass on (see `classify_by_similarity`)
    /// instead of every row, since a sign, marker or keyword match is
    /// already a confident enough signal on its own.
    pub direction_is_guessed: bool,
}

/// Splits a bank/card statement's extracted text into one row per
/// transaction, instead of `parse_receipt_text`'s single total -- see
/// that function's doc comment for why a receipt is deliberately
/// collapsed to one figure. A statement has no such single "total" to
/// anchor on.
///
/// Three real shapes came out of testing this against actual exported
/// statement PDFs (a mobile-wallet export, then a bank statement), not
/// just synthetic fixtures:
///
/// 1. **One line per transaction** -- `date … description … amount`, a
///    bank's own printed column order, all on one physical line. This is
///    what a first pass at this function assumed was the only shape.
/// 2. **One blank-line-delimited *block* per transaction, spanning
///    several physical lines** -- `pdf-extract`'s line breaks follow the
///    PDF's content stream, not always the visual row, so a single
///    transaction came out as `"06 Aug MERCHANT NAME"` on one line and
///    `"REF NO: ... 20.00 CR"` on the next, with only a blank line
///    separating one transaction's block from the next. The date also
///    had no year (`"06 Aug"`, not `"06 Aug 2026"` -- the year appears
///    once, in the statement's own header), and direction was a trailing
///    `CR`/`DB` word rather than a `+`/`-` sign.
/// 3. **A trailing running-balance column with no label of its own** --
///    either shape above, but the amount line ends `AMOUNT  BALANCE`
///    instead of just `AMOUNT`, with two spaces and no marker separating
///    them. See `find_statement_amount`'s own doc comment for how this
///    is told apart from the actual transaction amount.
///
/// `parse_statement_text` groups the text into blank-line-delimited
/// sections first. Within a section, if one or more individual lines
/// each independently carry both a date and an amount, every such line
/// becomes its own row (shape 1, and the common case when a PDF's table
/// structure survives extraction with no blank lines between rows at
/// all). Otherwise the whole section is pooled into a single row (shape
/// 2): the first date found across any of its lines, the last amount
/// found across any of its lines, description from whichever line held
/// the date. A section with no date anywhere, or no amount anywhere, is
/// not a transaction -- a header, a running-balance footer, page
/// furniture -- and contributes no row.
///
/// A day/month-only date resolves against `document_year`: the year of
/// the first fully-dated line found anywhere in the whole text (a
/// statement's own header date, in practice). Known v1 gap: nothing here
/// disambiguates a statement spanning a year boundary (a December
/// transaction under a January header date) -- same trade as
/// `csv_import`'s own documented gaps, always fixable in the review list
/// this never auto-saves into.
pub fn parse_statement_text(text: &str) -> Vec<StatementRow> {
    let document_year = find_document_year(text);
    let mut rows = Vec::new();
    for section in sections(text) {
        let per_line: Vec<StatementRow> = section
            .lines
            .iter()
            .filter_map(|&(line_no, line)| parse_statement_line(line_no, line, document_year))
            .collect();
        if !per_line.is_empty() {
            rows.extend(per_line);
            continue;
        }
        if let Some(row) = parse_statement_section(&section, document_year) {
            rows.push(row);
        }
    }
    rows
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

/// A run of consecutive non-blank lines, source line numbers kept
/// alongside each so a pooled row can still say which physical line it
/// came from -- see `parse_statement_text`'s doc comment for why a
/// transaction isn't always exactly one line.
struct Section<'a> {
    lines: Vec<(usize, &'a str)>,
}

fn sections(text: &str) -> Vec<Section<'_>> {
    let mut out = Vec::new();
    let mut current: Vec<(usize, &str)> = Vec::new();
    for (i, raw) in text.lines().enumerate() {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            if !current.is_empty() {
                out.push(Section {
                    lines: std::mem::take(&mut current),
                });
            }
            continue;
        }
        current.push((i + 1, trimmed));
    }
    if !current.is_empty() {
        out.push(Section { lines: current });
    }
    out
}

/// The year of the first fully-dated line anywhere in the document --
/// almost always a statement's own header date -- used to resolve a
/// day/month-only transaction date that has none of its own.
fn find_document_year(text: &str) -> Option<i32> {
    text.lines().find_map(|line| {
        let (_, iso) = find_date_token(line)?;
        iso.get(0..4)?.parse().ok()
    })
}

/// `find_date_token`, extended to also try a day/month-only match (a
/// statement transaction's own date, with the year resolved from
/// `document_year`) when no fully-dated token is present on the line.
fn find_row_date_token(line: &str, document_year: Option<i32>) -> Option<(String, String)> {
    find_date_token(line)
        .or_else(|| document_year.and_then(|year| find_day_month_token(line, year)))
}

const DAY_MONTH_FORMATS: [&str; 2] = ["%d %b %Y", "%b %d %Y"];

fn find_day_month_token(line: &str, year: i32) -> Option<(String, String)> {
    use chrono::NaiveDate;

    let words: Vec<&str> = line.split_whitespace().collect();
    for window in words.windows(2) {
        let joined = window.join(" ");
        let cleaned = joined.trim_matches(|c: char| c == ',');
        let with_year = format!("{cleaned} {year}");
        for fmt in DAY_MONTH_FORMATS {
            if let Ok(d) = NaiveDate::parse_from_str(&with_year, fmt) {
                return Some((joined.clone(), d.format("%Y-%m-%d").to_string()));
            }
        }
    }
    None
}

/// A trailing `CR`/`DB`/`DR` word right after an amount -- a statement's
/// own credit/debit marker, standing in for a `+`/`-` sign the extracted
/// text never has. `CR` (credit) is a positive/income-direction amount;
/// `DB`/`DR` (debit) is negative/expense-direction. `text_after_amount`
/// is everything on that line past the matched amount's own span.
fn trailing_direction_marker(text_after_amount: &str) -> Option<bool> {
    match text_after_amount
        .split_whitespace()
        .next()?
        .to_uppercase()
        .as_str()
    {
        "CR" => Some(true),
        "DB" | "DR" => Some(false),
        _ => None,
    }
}

/// Resolution order for a statement amount's direction: a sign or parens
/// actually written in the text always wins (it's unambiguous); then a
/// `CR`/`DB` marker (a statement's own explicit convention); then the
/// same income-keyword guess `parse_receipt_text` already makes; then
/// default to an expense, same default as a single receipt's total.
///
/// The second return value is `true` only in the final, no-signal
/// fallback branch -- no explicit sign, no marker, no keyword hit -- so
/// a caller can tell a confident guess apart from a pure default.
fn resolve_statement_amount(
    magnitude: Decimal,
    had_explicit_sign: bool,
    marker: Option<bool>,
    is_income_line: bool,
) -> (Decimal, bool) {
    if had_explicit_sign {
        (magnitude, false)
    } else if let Some(is_credit) = marker {
        (
            if is_credit {
                magnitude.abs()
            } else {
                -magnitude.abs()
            },
            false,
        )
    } else if is_income_line {
        (magnitude.abs(), false)
    } else {
        (-magnitude.abs(), true)
    }
}

/// Removes every given span from `chars`, latest-starting first so an
/// earlier span's indices stay valid as later ones are drained out.
fn strip_spans(chars: &[char], mut spans: Vec<(usize, usize)>) -> String {
    spans.sort_by_key(|&(start, _)| std::cmp::Reverse(start));
    let mut without = chars.to_vec();
    for (start, end) in spans {
        without.drain(start..end);
    }
    without.into_iter().collect()
}

/// Shape 1: a single line that independently carries both a date and an
/// amount. `None` for a line missing either -- not every line in a
/// section is a transaction line, e.g. a statement's own `REF NO: ...`
/// line in the two-line shape has an amount but no date of its own.
fn parse_statement_line(
    line_no: usize,
    line: &str,
    document_year: Option<i32>,
) -> Option<StatementRow> {
    let lower = line.to_lowercase();
    if STATEMENT_SKIP_KEYWORDS.iter().any(|k| lower.contains(k)) {
        return None;
    }

    let (date_token, date) = find_row_date_token(line, document_year)?;
    let (amount_start, amount_end, magnitude, had_explicit_sign, balance_span) =
        find_statement_amount(line)?;

    let chars: Vec<char> = line.chars().collect();
    let after_amount: String = chars[amount_end..].iter().collect();
    let marker = trailing_direction_marker(&after_amount);
    let is_income_line = INCOME_KEYWORDS.iter().any(|k| lower.contains(k));
    let (amount, direction_is_guessed) =
        resolve_statement_amount(magnitude, had_explicit_sign, marker, is_income_line);

    let mut spans = vec![(amount_start, amount_end)];
    if let Some(span) = balance_span {
        spans.push(span);
    }
    let without_amount = strip_spans(&chars, spans);
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
        direction_is_guessed,
    })
}

/// Shape 2: no single line in the section carries both a date and an
/// amount, so the section is pooled into one row -- the date from
/// whichever line has one, the amount from the last line that has one
/// (mirroring `find_statement_amount`'s own "last wins" choice, just
/// scoped to every line in the section instead of one line's own
/// tokens), description from the date's own line with the date stripped
/// out.
fn parse_statement_section(
    section: &Section<'_>,
    document_year: Option<i32>,
) -> Option<StatementRow> {
    let joined_lower = section
        .lines
        .iter()
        .map(|(_, l)| l.to_lowercase())
        .collect::<Vec<_>>()
        .join(" ");
    if STATEMENT_SKIP_KEYWORDS
        .iter()
        .any(|k| joined_lower.contains(k))
    {
        return None;
    }

    let (date_line_no, date_token, date) = section
        .lines
        .iter()
        .find_map(|&(no, l)| find_row_date_token(l, document_year).map(|(tok, d)| (no, tok, d)))?;

    let mut best_amount: Option<(&str, usize, usize, Decimal, bool)> = None;
    for &(_, l) in &section.lines {
        // The balance span (this line's trailing running-balance column,
        // if any) is irrelevant here: shape 2's description always comes
        // from the *date's own* line, never the amount line, so there's
        // nothing to strip it out of the way `parse_statement_line` does.
        if let Some((start, end, magnitude, had_sign, _balance_span)) = find_statement_amount(l) {
            best_amount = Some((l, start, end, magnitude, had_sign));
        }
    }
    let (amount_line, _amount_start, amount_end, magnitude, had_explicit_sign) = best_amount?;

    let amount_chars: Vec<char> = amount_line.chars().collect();
    let after_amount: String = amount_chars[amount_end..].iter().collect();
    let marker = trailing_direction_marker(&after_amount);
    let is_income_line = INCOME_KEYWORDS.iter().any(|k| joined_lower.contains(k));
    let (amount, direction_is_guessed) =
        resolve_statement_amount(magnitude, had_explicit_sign, marker, is_income_line);

    let date_source_line = section
        .lines
        .iter()
        .find(|&&(no, _)| no == date_line_no)
        .map(|&(_, l)| l)?;
    let description = date_source_line
        .replacen(&date_token, "", 1)
        .trim_matches(|c: char| !c.is_alphanumeric())
        .trim()
        .chars()
        .take(80)
        .collect::<String>();

    Some(StatementRow {
        line: date_line_no,
        date,
        description: if description.is_empty() {
            None
        } else {
            Some(description)
        },
        amount,
        is_income: amount.is_sign_positive(),
        direction_is_guessed,
    })
}

/// `(start, end, magnitude, had_explicit_sign, balance_span)` -- see
/// `find_statement_amount`'s own doc comment for what each field means.
type StatementAmountMatch = (usize, usize, Decimal, bool, Option<(usize, usize)>);

/// The transaction-amount money-like run in a line, as its character
/// span (so the caller can strip exactly that substring out of the
/// description) and signed value, plus the span of a trailing running-
/// balance run when one was found alongside it (so a caller can strip
/// that out of the description too, rather than leaving the account's
/// balance figure sitting in the row's description text). A run is
/// widened one character left to catch a leading `+`/`-` sign or, when
/// the whole run is `(`...`)`-wrapped, both parens -- mirroring
/// `extract_amounts`'s own paren handling -- so `had_explicit_sign` can
/// tell a written sign apart from a bare magnitude with no direction of
/// its own.
///
/// When exactly one money-like run exists on the line, it's the amount
/// -- the shape every statement tested before this function's second
/// real-world case used (a bank's own printed column order puts the
/// amount after the date and description, so it's always last on the
/// line, and choosing "last" over "largest" keeps an earlier fee/tax
/// figure from outranking it just for being bigger).
///
/// When two or more runs exist, the second-to-last is the amount and the
/// last is a running-balance column, not a second candidate. A real SG
/// bank statement PDF printed every transaction as `AMOUNT  BALANCE`
/// with no label distinguishing the two -- reading "last" as the amount
/// there silently took the account's running balance instead of the
/// actual withdrawal/deposit figure. No statement shape seen so far
/// prints more than one genuine amount on a transaction's own line, so
/// this is unambiguous rather than a guess among many candidates.
fn find_statement_amount(line: &str) -> Option<StatementAmountMatch> {
    let chars: Vec<char> = line.chars().collect();
    let mut candidates: Vec<(usize, usize, Decimal, bool)> = Vec::new();
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
            candidates.push((start, end, amount, had_explicit_sign));
        }
    }
    if candidates.len() >= 2 {
        let (b_start, b_end, ..) = candidates[candidates.len() - 1];
        let (a_start, a_end, a_magnitude, a_had_sign) = candidates[candidates.len() - 2];
        Some((
            a_start,
            a_end,
            a_magnitude,
            a_had_sign,
            Some((b_start, b_end)),
        ))
    } else {
        candidates
            .into_iter()
            .next()
            .map(|(s, e, m, sign)| (s, e, m, sign, None))
    }
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
        let text = "15/05/2026 STARBUCKS -4.50\n\
                     16/05/2026 SALARY DEPOSIT +3000.00\n\
                     17/05/2026 RENT -1500.00\n";
        let rows = parse_statement_text(text);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].date, "2026-05-15");
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
        assert!(!rows[0].direction_is_guessed);
    }

    #[test]
    fn an_unsigned_amount_defaults_to_an_expense() {
        let rows = parse_statement_text("05/01/2026 COFFEE SHOP 4.50\n");
        assert_eq!(rows[0].amount, dec!(-4.50));
        assert!(rows[0].direction_is_guessed);
    }

    #[test]
    fn an_unsigned_amount_on_an_income_keyword_line_becomes_positive() {
        let rows = parse_statement_text("05/01/2026 REFUND FROM STORE 4.50\n");
        assert_eq!(rows[0].amount, dec!(4.50));
        assert!(rows[0].is_income);
        assert!(!rows[0].direction_is_guessed);
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
        let rows =
            parse_statement_text("05/01/2026 STARBUCKS -4.50\n05/01/2026 Ending balance 1234.56\n");
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

    #[test]
    fn a_day_month_date_resolves_against_the_document_year_and_a_cr_marker_is_income() {
        let text = "2026-08-01 OPENING BALANCE 1000.00\n\n06 Aug MERCHANT FOUR 15.00 CR\n";
        let rows = parse_statement_text(text);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].date, "2026-08-06");
        assert_eq!(rows[0].amount, dec!(15.00));
        assert!(rows[0].is_income);
    }

    #[test]
    fn a_trailing_db_marker_makes_the_amount_negative_expense() {
        let text = "2026-08-01 OPENING BALANCE 1000.00\n\n06 Aug MERCHANT FIVE 15.00 DB\n";
        let rows = parse_statement_text(text);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].amount, dec!(-15.00));
        assert!(!rows[0].is_income);
        assert!(!rows[0].direction_is_guessed);
    }

    #[test]
    fn classify_by_similarity_picks_the_higher_scoring_side() {
        assert!(classify_by_similarity(0.8, 0.3));
        assert!(!classify_by_similarity(0.3, 0.8));
    }

    #[test]
    fn classify_by_similarity_ties_favor_expense() {
        assert!(!classify_by_similarity(0.5, 0.5));
    }

    #[test]
    fn a_two_line_block_separated_by_a_blank_line_is_pooled_into_one_row() {
        let text = "Statement period ending 08/31/2026\n\n\
                     07 Aug MERCHANT THREE\n\
                     REF NO: TF000000000000000002 30.00 CR\n";
        let rows = parse_statement_text(text);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].date, "2026-08-07");
        assert_eq!(rows[0].amount, dec!(30.00));
        assert!(rows[0].is_income);
    }

    #[test]
    fn a_day_month_date_with_no_document_year_anywhere_is_not_a_transaction_row() {
        let rows = parse_statement_text("06 Aug MERCHANT SIX 15.00 CR\n");
        assert!(rows.is_empty());
    }

    #[test]
    fn an_ambiguous_numeric_date_defaults_to_day_first_not_us_month_first() {
        // 03/08 is a valid date either way (day=3/month=8 or month=3/day=8)
        // -- this app's userbase reads it day-first (international/SG
        // convention), not US month-first.
        let parsed = parse_receipt_text("SHOP\n03/08/2026\nTotal 10.00\n");
        assert_eq!(parsed.date, Some("2026-08-03".to_string()));
    }

    #[test]
    fn an_unambiguous_numeric_date_still_resolves_correctly_despite_the_day_first_default() {
        let parsed = parse_receipt_text("SHOP\n08/27/2026\nTotal 10.00\n");
        assert_eq!(parsed.date, Some("2026-08-27".to_string()));
    }

    #[test]
    fn a_trailing_running_balance_is_not_mistaken_for_the_amount_on_a_single_line() {
        // Real SG bank statement shape: date, description and the
        // AMOUNT BALANCE pair all on one physical line, with no label
        // distinguishing the two trailing numbers.
        let rows = parse_statement_text("31/08/2026 INTEREST PAID 2.51  77580.68\n");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].amount, dec!(-2.51));
    }

    #[test]
    fn a_trailing_running_balance_is_stripped_out_of_the_description_too() {
        let rows = parse_statement_text("31/08/2026 INTEREST PAID 2.51  77580.68\n");
        assert_eq!(rows[0].description, Some("INTEREST PAID".to_string()));
    }

    #[test]
    fn a_trailing_running_balance_is_not_mistaken_for_the_amount_in_a_pooled_section() {
        let text = "2026-08-01 OPENING BALANCE 1000.00\n\n\
                     31/08/2026 SOME MERCHANT NAME\n\
                     REF: ABCDEF123456\n\
                     3850.01  77578.17\n";
        let rows = parse_statement_text(text);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].amount, dec!(-3850.01));
    }
}
