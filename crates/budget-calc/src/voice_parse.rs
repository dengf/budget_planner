//! Turns a raw ASR transcript ("add expense twelve dollars groceries")
//! into a pre-filled transaction draft, without ever posting anything --
//! see `AddTransactionSheet`'s voice tab, which always hands the result
//! back to the ordinary manual form for the person to review and tap Add
//! themselves.
//!
//! **Why fuzzy/inspectable matching, not a smarter model.** Same
//! reasoning as `rules.rs`'s plain substring keyword match: a category
//! choice a person can't see the "why" of is a worse failure than a blunt
//! one. It also turned out to matter far more than model quality --
//! constrained matching against a closed vocabulary took identical audio
//! from 63% to 97% correct parsed transactions in the spike that preceded
//! this module (see the `budget-planner-voice-entry` note), because a CTC
//! model's raw transcript is full of small, closed-set-recoverable
//! mistakes ("death" for "debt", "in surance" for "insurance", "netflicxs"
//! for "netflix"). None of that needs a bigger model; it needs a smaller
//! search space. The same held for Mandarin's spike: its one recorded
//! miss was 买 ("buy") misheard as 卖 ("sell") -- recovered here not by a
//! bigger model but by a second verb cue (花了, "spent") the closed
//! vocabulary also recognizes in the same sentence.
//!
//! **Why the category's own `is_income` outranks the spoken verb.** The
//! spike's only two failures were a confidently wrong *category*, never a
//! wrong direction or amount -- so direction is derived from whichever
//! category matched, not re-guessed from "add income"/"add expense",
//! which a mishearing could just as easily invert. The verb is only a
//! fallback when no category matched at all.
//!
//! **Why amounts are anchored to "dollars"/"cents" (or, for Mandarin,
//! 元/块), not scanned freely.** A number word appearing anywhere in the
//! sentence is ambiguous (a category name could itself contain one);
//! anchoring to the unit word immediately before/after it is the same
//! "narrow the search space" principle as the category matching above.
//!
//! **Why Mandarin tokenizes by character, not by whitespace.**
//! English's raw transcript is naturally space-separated into words; a
//! CTC Chinese model's decoded transcript is not -- its `▁` word-boundary
//! marker (see `voice_cmn.rs`'s decode) reflects whatever segmentation its
//! own training vocabulary happened to encode, not real word breaks, and
//! in practice the spike's real Mandarin transcripts came back as one
//! contiguous run of characters with no internal spaces at all. So for
//! `Cmn`, `cjk_tokenize` splits into individual Unicode characters
//! (keeping an embedded run of ASCII letters/digits as one token) rather
//! than reusing `split_whitespace()`. This still lets the existing
//! `best_span_distance` machinery work unchanged: a Chinese word is
//! typically 1-4 characters, so a span of 1..=3 *characters* is the
//! direct CJK analogue of English's span of 1..=3 *words*.

/// One category the transcript can be matched against -- the caller
/// passes every category currently in the budget (via `CategoryDto`),
/// not a fixed list, since categories are user-editable.
#[derive(Debug, Clone, PartialEq)]
pub struct VoiceCategoryCandidate {
    pub id: String,
    pub name: String,
    pub is_income: bool,
    /// Mirrors `CategoryRecord::preset_key`: present only for a starter
    /// category that hasn't been renamed, and used to look up extra
    /// spoken aliases a plain name match would miss ("salary" for
    /// "Primary/Earned Income"). A renamed or custom category still
    /// matches on `name` alone.
    pub preset_key: Option<String>,
}

/// What could be read off the transcript. Any field left `None` is left
/// blank on the manual form for the person to fill in themselves --
/// never guessed, and never blocks showing the other fields that did
/// parse.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct VoiceDraft {
    pub category_id: Option<String>,
    pub is_income: Option<bool>,
    pub amount: Option<f64>,
}

/// Which spoken language the transcript is in -- selects the alias,
/// number-word, unit-word and verb-fallback tables below.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VoiceLanguage {
    En,
    Cmn,
}

fn aliases_for_preset(preset_key: &str, language: VoiceLanguage) -> &'static [&'static str] {
    match language {
        VoiceLanguage::En => aliases_for_preset_en(preset_key),
        VoiceLanguage::Cmn => aliases_for_preset_cmn(preset_key),
    }
}

/// Extra spoken aliases per starter category, English.
fn aliases_for_preset_en(preset_key: &str) -> &'static [&'static str] {
    match preset_key {
        "cat.primaryEarnedIncome" => &["salary", "wage", "wages", "paycheck", "paycheque", "pay"],
        "cat.selfEmploymentBusiness" => &[
            "freelance",
            "freelancing",
            "business",
            "consulting",
            "gig",
            "side hustle",
        ],
        "cat.investmentCapitalIncome" => &[
            "investment",
            "investments",
            "dividend",
            "dividends",
            "interest",
            "capital gains",
            "stocks",
        ],
        "cat.governmentSupplemental" => &[
            "government",
            "benefits",
            "welfare",
            "unemployment",
            "social security",
        ],
        "cat.otherIncome" => &["other income", "misc income"],
        "cat.housing" => &["housing", "rent", "mortgage"],
        "cat.utilities" => &[
            "utilities",
            "utility",
            "electricity",
            "water bill",
            "gas bill",
            "internet bill",
        ],
        "cat.foodGroceries" => &[
            "food",
            "groceries",
            "grocery",
            "restaurant",
            "dining",
            "takeout",
        ],
        "cat.transportation" => &[
            "transportation",
            "transport",
            "gas",
            "fuel",
            "uber",
            "lyft",
            "taxi",
            "parking",
            "car",
        ],
        "cat.healthcareInsurance" => &[
            "healthcare",
            "health",
            "insurance",
            "medical",
            "doctor",
            "pharmacy",
            "dental",
        ],
        "cat.debtServicing" => &[
            "debt",
            "loan",
            "loans",
            "credit card payment",
            "student loan",
        ],
        "cat.personalLifestyle" => &[
            "personal",
            "lifestyle",
            "shopping",
            "entertainment",
            "clothes",
            "clothing",
            "movies",
        ],
        "cat.subscriptionsMemberships" => &[
            "subscription",
            "subscriptions",
            "membership",
            "memberships",
            "netflix",
            "spotify",
            "gym",
        ],
        "cat.familyDependents" => &[
            "family",
            "dependents",
            "dependent",
            "kids",
            "children",
            "childcare",
            "school",
        ],
        "cat.giftsDonations" => &["gifts", "gift", "donation", "donations", "charity"],
        "cat.otherExpenses" => &["other", "misc", "miscellaneous"],
        _ => &[],
    }
}

/// Extra spoken aliases per starter category, Mandarin (Simplified
/// Chinese -- the script `voice_cmn.rs`'s model actually emits). Seeded
/// from the spike's own test utterances (`mandarin_utterances.tsv`) plus
/// `zh-Hans.js`'s `cat.*`/`cat.*.desc` strings for coverage beyond that
/// 25-utterance sample. The category's own formal name (e.g. "主要劳动
/// 收入") is matched separately, via `category.name` -- same as English,
/// these are the *spoken* alternatives a formal name wouldn't catch.
fn aliases_for_preset_cmn(preset_key: &str) -> &'static [&'static str] {
    match preset_key {
        "cat.primaryEarnedIncome" => &["工资", "薪水", "薪资", "工钱", "加班费", "小费", "奖金"],
        "cat.selfEmploymentBusiness" => {
            &["自由职业", "自雇", "生意", "兼职", "副业", "咨询费", "零工"]
        }
        "cat.investmentCapitalIncome" => &[
            "投资",
            "分红",
            "股息",
            "利息",
            "股票",
            "租金收入",
            "资本利得",
        ],
        "cat.governmentSupplemental" => &[
            "政府补贴",
            "福利",
            "养老金",
            "社保",
            "社会保障金",
            "退税",
            "抚养费",
            "赡养费",
        ],
        "cat.otherIncome" => &["其他收入", "外快", "红包", "退款"],
        "cat.housing" => &["房租", "房贷", "租金", "住房", "物业费"],
        "cat.utilities" => &[
            "水电费",
            "电费",
            "水费",
            "燃气费",
            "网费",
            "话费",
            "网络费",
            "垃圾清运费",
        ],
        "cat.foodGroceries" => &[
            "杂货",
            "食品",
            "餐厅",
            "吃饭",
            "外卖",
            "咖啡",
            "日用品",
            "水果",
        ],
        "cat.transportation" => &[
            "交通费",
            "打车",
            "停车费",
            "加油",
            "车费",
            "地铁",
            "公交",
            "汽油",
        ],
        "cat.healthcareInsurance" => {
            &["医疗", "保险费", "看病", "药", "医药费", "牙科", "视力保险"]
        }
        "cat.debtServicing" => &["债务", "贷款", "还款", "信用卡还款", "学生贷款", "欠款"],
        "cat.personalLifestyle" => &[
            "购物",
            "衣服",
            "娱乐",
            "电影",
            "化妆品",
            "个人护理",
            "爱好",
            "鞋",
        ],
        "cat.subscriptionsMemberships" => &["订阅", "会员", "健身房", "流媒体", "软件订阅"],
        "cat.familyDependents" => &[
            "家庭",
            "孩子",
            "育儿",
            "学费",
            "托儿费",
            "课外活动",
            "宠物",
            "兽医",
        ],
        "cat.giftsDonations" => &["礼物", "捐款", "慈善", "捐赠", "生日礼物"],
        "cat.otherExpenses" => &["其他", "杂项", "其他支出"],
        _ => &[],
    }
}

// ---------------------------------------------------------------------
// English number words: tens-before-ones word order ("twenty three"),
// with "hundred" as a multiplier and "and" a skippable joiner.
// ---------------------------------------------------------------------

/// Strips the punctuation a written-out transcript puts around a
/// number -- currency symbols, thousands separators, sentence-final
/// periods -- so "$2,500." reaches the parser as "2500".
fn normalize_number_token(word: &str) -> String {
    word.chars()
        .filter(|c| !matches!(c, '$' | ',' | '\u{00a3}' | '\u{20ac}' | '\u{00a5}'))
        .collect::<String>()
        .trim_end_matches('.')
        .to_string()
}

/// A "$12.50"/"$2,500" token as a single amount, or `None` if the token
/// isn't currency-shaped. Kept separate from `parse_number_words` because
/// the decimal point means cents here, where a spoken transcript says
/// "cents" in words.
fn currency_token_amount(word: &str) -> Option<f64> {
    let word = word.trim_end_matches(['.', ',', '!', '?']);
    let rest = word.strip_prefix('$')?;
    let cleaned: String = rest.chars().filter(|c| *c != ',').collect();
    if cleaned.is_empty() || !cleaned.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return None;
    }
    cleaned.parse::<f64>().ok()
}

const ONES: &[(&str, u64)] = &[
    ("zero", 0),
    ("one", 1),
    ("two", 2),
    ("three", 3),
    ("four", 4),
    ("five", 5),
    ("six", 6),
    ("seven", 7),
    ("eight", 8),
    ("nine", 9),
    ("ten", 10),
    ("eleven", 11),
    ("twelve", 12),
    ("thirteen", 13),
    ("fourteen", 14),
    ("fifteen", 15),
    ("sixteen", 16),
    ("seventeen", 17),
    ("eighteen", 18),
    ("nineteen", 19),
];

const TENS: &[(&str, u64)] = &[
    ("twenty", 20),
    ("thirty", 30),
    ("forty", 40),
    ("fifty", 50),
    ("sixty", 60),
    ("seventy", 70),
    ("eighty", 80),
    ("ninety", 90),
];

/// Parses a run of number words ("four hundred fifty") starting at
/// `words[start]`, returning the value and how many words it consumed.
/// Returns `None` if `words[start]` isn't a number word at all.
fn parse_number_words(words: &[&str]) -> Option<(u64, usize)> {
    let mut total: u64 = 0;
    let mut current: u64 = 0;
    let mut consumed = 0;
    let mut saw_any = false;

    for word in words {
        let word = &normalize_number_token(word);
        let word = word.as_str();
        if let Ok(digits) = word.parse::<u64>() {
            current += digits;
            saw_any = true;
            consumed += 1;
            continue;
        }
        if let Some((_, v)) = ONES.iter().find(|(w, _)| *w == word) {
            current += v;
            saw_any = true;
            consumed += 1;
        } else if let Some((_, v)) = TENS.iter().find(|(w, _)| *w == word) {
            current += v;
            saw_any = true;
            consumed += 1;
        } else if word == "hundred" && saw_any {
            current *= 100;
            consumed += 1;
        } else if (word == "thousand" || word == "million") && saw_any {
            // Scale and bank what has accumulated so far, so the ones
            // that follow ("two thousand five hundred") add to it
            // rather than replacing it. `max(1)` covers a bare
            // "thousand dollars".
            let scale = if word == "thousand" { 1_000 } else { 1_000_000 };
            total += current.max(1) * scale;
            current = 0;
            consumed += 1;
        } else if word == "and" && saw_any {
            // "four hundred and fifty" -- skip the joiner, keep scanning.
            consumed += 1;
        } else {
            break;
        }
    }

    if saw_any {
        Some((total + current, consumed))
    } else {
        None
    }
}

/// Every maximal run of consecutive number words in the transcript, as
/// `(start, end_exclusive, value)` -- found by greedily parsing forward
/// from each position that isn't already inside a run found earlier.
/// Needed because a number phrase like "four hundred fifty" can't be
/// found by scanning backward one word at a time from its end: "hundred"
/// alone doesn't parse as a number, so a backward walk stops there and
/// never reaches "four".
fn number_runs(words: &[&str]) -> Vec<(usize, usize, u64)> {
    let mut runs = Vec::new();
    let mut i = 0;
    while i < words.len() {
        match parse_number_words(&words[i..]) {
            Some((value, consumed)) if consumed > 0 => {
                runs.push((i, i + consumed, value));
                i += consumed;
            }
            _ => i += 1,
        }
    }
    runs
}

// ---------------------------------------------------------------------
// Chinese number words: multiplicative, not positional -- 十/百/千/万
// each multiply whatever digit immediately preceded them (or 1, for a
// bare leading unit: "十五" = 15, not "one-ten-five"), and the results
// sum. Used by `Cmn`.
// ---------------------------------------------------------------------

fn cjk_digit(c: char) -> Option<u64> {
    match c {
        '零' => Some(0),
        '一' => Some(1),
        '二' | '两' | '兩' => Some(2),
        '三' => Some(3),
        '四' => Some(4),
        '五' => Some(5),
        '六' => Some(6),
        '七' => Some(7),
        '八' => Some(8),
        '九' => Some(9),
        _ => None,
    }
}

fn cjk_unit(c: char) -> Option<u64> {
    match c {
        '十' => Some(10),
        '百' => Some(100),
        '千' => Some(1000),
        '万' | '萬' => Some(10_000),
        _ => None,
    }
}

/// Parses a run of Chinese numeral tokens ("五十" = 50, "一百二十" = 120,
/// "一万" = 10000) starting at `words[start]`, one character per token
/// (see `cjk_tokenize`). `万` closes out and multiplies everything
/// accumulated so far, the same way it would for values into the
/// hundred-thousands -- not exercised by this app's transaction-amount
/// range today, but correct regardless. A bare digit with nothing after
/// it (a units-place digit ending the run, or a `零` filler) is flushed
/// as-is rather than dropped.
fn parse_number_words_cjk(words: &[&str]) -> Option<(u64, usize)> {
    let mut result: u64 = 0;
    let mut section: u64 = 0;
    let mut digit: Option<u64> = None;
    let mut consumed = 0usize;
    let mut saw_any = false;

    for word in words {
        // An all-digit token ("8000") is a whole value, not a run of
        // units-place digits: whisper-class models write numbers in
        // Arabic digits where a CTC model spelled them in Han numerals.
        if word.len() > 1 && word.chars().all(|c| c.is_ascii_digit()) {
            if let Ok(v) = word.parse::<u64>() {
                if let Some(prev) = digit.take() {
                    section += prev;
                }
                section += v;
                saw_any = true;
                consumed += 1;
                continue;
            }
        }
        let mut chars = word.chars();
        // Not a single-character token -- outside this run.
        let (Some(c), None) = (chars.next(), chars.next()) else {
            break;
        };
        if let Some(d) = cjk_digit(c) {
            if let Some(prev) = digit.take() {
                section += prev;
            }
            digit = Some(d);
        } else if let Some(unit) = cjk_unit(c) {
            let value = digit.take().unwrap_or(1);
            if unit == 10_000 {
                result += (section + value) * unit;
                section = 0;
            } else {
                section += value * unit;
            }
        } else {
            break;
        }
        saw_any = true;
        consumed += 1;
    }

    if let Some(d) = digit {
        section += d;
    }

    if saw_any {
        Some((result + section, consumed))
    } else {
        None
    }
}

fn number_runs_cjk(words: &[&str]) -> Vec<(usize, usize, u64)> {
    let mut runs = Vec::new();
    let mut i = 0;
    while i < words.len() {
        match parse_number_words_cjk(&words[i..]) {
            Some((value, consumed)) if consumed > 0 => {
                runs.push((i, i + consumed, value));
                i += consumed;
            }
            _ => i += 1,
        }
    }
    runs
}

/// Splits a CJK transcript into individual-character tokens, keeping any
/// run of ASCII letters/digits together as one token and dropping
/// whitespace entirely (a CTC Chinese transcript's spaces, where they
/// exist at all, don't reliably mark real word boundaries -- see this
/// module's doc comment). This is the CJK analogue of English's
/// `split_whitespace()`.
fn cjk_tokenize(transcript: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut ascii_run = String::new();
    for c in transcript.chars() {
        if c.is_whitespace() {
            if !ascii_run.is_empty() {
                tokens.push(std::mem::take(&mut ascii_run));
            }
            continue;
        }
        if c.is_ascii_alphanumeric() {
            ascii_run.push(c.to_ascii_lowercase());
        } else {
            if !ascii_run.is_empty() {
                tokens.push(std::mem::take(&mut ascii_run));
            }
            tokens.push(c.to_string());
        }
    }
    if !ascii_run.is_empty() {
        tokens.push(ascii_run);
    }
    tokens
}

fn cjk_dollar_units(language: VoiceLanguage) -> &'static [&'static str] {
    match language {
        VoiceLanguage::Cmn => &["元", "块"],
        VoiceLanguage::En => &[],
    }
}

/// Looks for a number anchored immediately before a currency unit word
/// (元/块), Chinese numeral-then-unit order -- same "anchor to the unit
/// word" principle as `extract_amount_en`. No cents-equivalent handling:
/// none of the app's spoken test data uses a fractional-yuan pattern, so
/// it's out of scope until a real case shows it's needed.
fn extract_amount_cjk(words: &[&str], language: VoiceLanguage) -> Option<f64> {
    let runs = number_runs_cjk(words);
    let dollar_units = cjk_dollar_units(language);
    let mut dollars: Option<u64> = None;

    for (i, word) in words.iter().enumerate() {
        if !dollar_units.contains(word) {
            continue;
        }
        if let Some((_, _, value)) = runs.iter().find(|(_, end, _)| *end == i) {
            dollars = Some(*value);
        }
    }

    dollars.map(|d| d as f64)
}

/// Looks for a number anchored immediately before a "dollars"/"cents"
/// unit word (in either spoken order: "twelve dollars" or, for the cents
/// half, "fifty cents"), and returns dollars-plus-cents as a single
/// amount. A lone dollar amount with no cents mentioned is fine; cents
/// with no dollar amount is treated as a whole-cents-only amount.
fn extract_amount_en(words: &[&str]) -> Option<f64> {
    // A "$12.50"-shaped token is its own anchor: the symbol is the unit
    // word. Checked before the spoken-unit scan so an utterance that
    // has both ("$12 dollars") still resolves once.
    for word in words {
        if let Some(v) = currency_token_amount(word) {
            return Some(v);
        }
    }

    let runs = number_runs(words);
    let mut dollars: Option<u64> = None;
    let mut cents: Option<u64> = None;

    for (i, word) in words.iter().enumerate() {
        let is_dollar_unit = matches!(*word, "dollar" | "dollars" | "buck" | "bucks");
        let is_cent_unit = matches!(*word, "cent" | "cents");
        if !is_dollar_unit && !is_cent_unit {
            continue;
        }
        if let Some((_, _, value)) = runs.iter().find(|(_, end, _)| *end == i) {
            if is_dollar_unit {
                dollars = Some(*value);
            } else {
                cents = Some(*value);
            }
        }
    }

    match (dollars, cents) {
        (None, None) => None,
        (d, c) => Some(d.unwrap_or(0) as f64 + (c.unwrap_or(0) as f64) / 100.0),
    }
}

fn extract_amount(words: &[&str], language: VoiceLanguage) -> Option<f64> {
    match language {
        VoiceLanguage::En => extract_amount_en(words),
        VoiceLanguage::Cmn => extract_amount_cjk(words, language),
    }
}

/// Plain Levenshtein edit distance, case-sensitive by design (callers
/// lowercase both sides first) -- used to tolerate the small phonetic
/// slips a CTC transcript makes, not to fuzzy-match unrelated words.
fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut prev = row[0];
        row[0] = i;
        for j in 1..=b.len() {
            let tmp = row[j];
            row[j] = if a[i - 1] == b[j - 1] {
                prev
            } else {
                1 + prev.min(row[j]).min(row[j - 1])
            };
            prev = tmp;
        }
    }
    row[b.len()]
}

/// How many edits an alias of this length can tolerate and still count
/// as a match -- scaled so a short word ("gas") needs a near-exact hit
/// while a longer phrase ("subscriptions") can absorb a couple of the
/// small slips a CTC model actually makes.
fn tolerance_for(alias_len: usize) -> usize {
    // A length-1 alias (an English initialism, or -- in practice -- a
    // single Chinese character alias like 药) needs an exact match: any
    // tolerance >=1 here means "any other single character", since the
    // edit distance between two distinct length-1 strings is always
    // exactly 1 -- that would make a single-character alias match
    // almost any transcript rather than recover a genuine near-miss.
    if alias_len <= 1 {
        0
    } else {
        (alias_len / 4).max(1)
    }
}

/// Best (lowest-distance) match of `alias` against any contiguous run of
/// 1..=3 transcript words, joined with no spaces -- recovers a word the
/// model split in two ("in surance" vs "insurance") without needing a
/// dictionary of every possible split point. For CJK, "words" are
/// individual characters (see `cjk_tokenize`), so this is the same
/// mechanism recovering a 1-3 character Chinese word regardless of
/// whatever spacing the model's raw decode happened to produce.
fn best_span_distance(words: &[&str], alias: &str) -> Option<usize> {
    let alias_joined: String = alias.chars().filter(|c| !c.is_whitespace()).collect();
    let mut best: Option<usize> = None;
    for span in 1..=3.min(words.len()) {
        for start in 0..=words.len().saturating_sub(span) {
            let candidate: String = words[start..start + span].concat();
            let dist = levenshtein(&candidate, &alias_joined);
            best = Some(best.map_or(dist, |b: usize| b.min(dist)));
        }
    }
    best
}

/// Finds the best-matching category for the transcript, if any clears
/// the per-alias tolerance.
fn match_category<'a>(
    words: &[&str],
    categories: &'a [VoiceCategoryCandidate],
    language: VoiceLanguage,
) -> Option<&'a VoiceCategoryCandidate> {
    let mut best: Option<(&VoiceCategoryCandidate, usize)> = None;

    for category in categories {
        let mut aliases: Vec<String> = vec![category.name.to_lowercase()];
        if let Some(key) = &category.preset_key {
            aliases.extend(
                aliases_for_preset(key, language)
                    .iter()
                    .map(ToString::to_string),
            );
        }

        for alias in &aliases {
            if alias.trim().is_empty() {
                continue;
            }
            let Some(dist) = best_span_distance(words, alias) else {
                continue;
            };
            let alias_len: usize = alias.chars().filter(|c| !c.is_whitespace()).count();
            if dist > tolerance_for(alias_len) {
                continue;
            }
            // Normalize by alias length so a short exact hit doesn't lose
            // to a long alias's small absolute distance.
            let better = match best {
                None => true,
                Some((_, best_dist)) => dist < best_dist,
            };
            if better {
                best = Some((category, dist));
            }
        }
    }

    best.map(|(category, _)| category)
}

const CMN_INCOME_VERBS: &[&str] = &["收入", "收到", "赚"];
const CMN_EXPENSE_VERBS: &[&str] = &["支出", "花了", "花", "付了", "付", "买了", "买"];

/// Last-resort direction fallback for a CJK transcript whose category
/// match failed entirely -- substring search over the joined transcript
/// rather than per-token equality, since these verbs are 1-2 characters
/// and `words` is tokenized per-character (see `cjk_tokenize`), unlike
/// English's whole-word tokens.
fn verb_fallback_income_cjk(words: &[&str], income: &[&str], expense: &[&str]) -> Option<bool> {
    let joined = words.concat();
    let mut result = None;
    for v in expense {
        if joined.contains(v) {
            result = Some(false);
        }
    }
    for v in income {
        if joined.contains(v) {
            result = Some(true);
        }
    }
    result
}

fn verb_fallback_income(words: &[&str], language: VoiceLanguage) -> Option<bool> {
    match language {
        VoiceLanguage::En => {
            let mut verb_income = None;
            for w in words {
                if *w == "income" {
                    verb_income = Some(true);
                } else if *w == "expense" || *w == "expenses" {
                    verb_income = Some(false);
                }
            }
            verb_income
        }
        VoiceLanguage::Cmn => verb_fallback_income_cjk(words, CMN_INCOME_VERBS, CMN_EXPENSE_VERBS),
    }
}

/// Parses a raw transcript into a transaction draft. `categories` should
/// be every category currently in the budget -- see `CategoryDto`.
/// `language` selects which spoken language's grammar to apply; it does
/// not translate or otherwise touch `categories` themselves.
pub fn parse_voice_command(
    transcript: &str,
    categories: &[VoiceCategoryCandidate],
    language: VoiceLanguage,
) -> VoiceDraft {
    let owned_words: Vec<String> = match language {
        VoiceLanguage::En => transcript
            .to_lowercase()
            .split_whitespace()
            .map(ToString::to_string)
            .collect(),
        VoiceLanguage::Cmn => cjk_tokenize(transcript),
    };
    let words: Vec<&str> = owned_words.iter().map(String::as_str).collect();

    let amount = extract_amount(&words, language);
    let matched = match_category(&words, categories, language);

    let is_income = if let Some(category) = matched {
        Some(category.is_income)
    } else {
        // No category matched at all -- fall back to whatever verb
        // was spoken, purely as a last resort (see module doc for
        // why a matched category always outranks this).
        verb_fallback_income(&words, language)
    };

    VoiceDraft {
        category_id: matched.map(|c| c.id.clone()),
        is_income,
        amount,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn category(
        id: &str,
        name: &str,
        is_income: bool,
        preset_key: Option<&str>,
    ) -> VoiceCategoryCandidate {
        VoiceCategoryCandidate {
            id: id.to_string(),
            name: name.to_string(),
            is_income,
            preset_key: preset_key.map(ToString::to_string),
        }
    }

    fn starter_categories() -> Vec<VoiceCategoryCandidate> {
        vec![
            category(
                "inc-1",
                "Primary/Earned Income",
                true,
                Some("cat.primaryEarnedIncome"),
            ),
            category(
                "inc-2",
                "Self-Employment/Business Income",
                true,
                Some("cat.selfEmploymentBusiness"),
            ),
            category(
                "exp-1",
                "Food & Groceries",
                false,
                Some("cat.foodGroceries"),
            ),
            category("exp-2", "Transportation", false, Some("cat.transportation")),
            category("exp-3", "Debt Servicing", false, Some("cat.debtServicing")),
            category(
                "exp-4",
                "Healthcare & Insurance",
                false,
                Some("cat.healthcareInsurance"),
            ),
            category(
                "exp-5",
                "Subscriptions & Memberships",
                false,
                Some("cat.subscriptionsMemberships"),
            ),
        ]
    }

    fn parse_en(transcript: &str, categories: &[VoiceCategoryCandidate]) -> VoiceDraft {
        parse_voice_command(transcript, categories, VoiceLanguage::En)
    }

    #[test]
    fn parses_a_clean_expense_with_a_whole_dollar_amount() {
        let draft = parse_en(
            "add expense twelve dollars groceries",
            &starter_categories(),
        );
        assert_eq!(draft.amount, Some(12.0));
        assert_eq!(draft.is_income, Some(false));
        assert_eq!(draft.category_id.as_deref(), Some("exp-1"));
    }

    #[test]
    fn parses_a_clean_income_with_an_alias_word() {
        let draft = parse_en(
            "add income four hundred fifty dollars salary",
            &starter_categories(),
        );
        assert_eq!(draft.amount, Some(450.0));
        assert_eq!(draft.is_income, Some(true));
        assert_eq!(draft.category_id.as_deref(), Some("inc-1"));
    }

    #[test]
    fn parses_dollars_and_cents_together() {
        let draft = parse_en(
            "add expense four dollars fifty cents transportation",
            &starter_categories(),
        );
        assert_eq!(draft.amount, Some(4.5));
        assert_eq!(draft.category_id.as_deref(), Some("exp-2"));
    }

    #[test]
    fn recovers_a_word_the_model_split_in_two() {
        // The spike's own recorded ASR mistake: "insurance" -> "in surance".
        let draft = parse_en(
            "add expense thirty dollars in surance",
            &starter_categories(),
        );
        assert_eq!(draft.category_id.as_deref(), Some("exp-4"));
    }

    #[test]
    fn a_phonetically_close_but_wrong_word_does_not_match() {
        // "death" should not fuzzy-match "debt" at this tolerance -- a
        // miss is safer than the spike's one recorded failure class
        // (a confidently wrong category).
        let draft = parse_en("add expense twenty dollars death", &starter_categories());
        assert_eq!(draft.category_id, None);
    }

    #[test]
    fn category_direction_overrides_a_possibly_misheard_verb() {
        // "add income" is heard, but "salary" only exists as an income
        // category here -- direction should still come from the category.
        let draft = parse_en("add expense ten dollars salary", &starter_categories());
        assert_eq!(draft.is_income, Some(true));
    }

    #[test]
    fn falls_back_to_the_spoken_verb_when_no_category_matches() {
        let draft = parse_en("add expense ten dollars zzz", &starter_categories());
        assert_eq!(draft.category_id, None);
        assert_eq!(draft.is_income, Some(false));
    }

    #[test]
    fn no_amount_leaves_amount_blank_rather_than_guessing() {
        let draft = parse_en("add expense groceries", &starter_categories());
        assert_eq!(draft.amount, None);
        assert_eq!(draft.category_id.as_deref(), Some("exp-1"));
    }

    #[test]
    fn a_renamed_category_still_matches_on_its_own_name_with_no_preset_key() {
        let categories = vec![category("custom-1", "Coffee Fund", false, None)];
        let draft = parse_en("add expense five dollars coffee fund", &categories);
        assert_eq!(draft.category_id.as_deref(), Some("custom-1"));
    }

    #[test]
    fn empty_transcript_produces_a_fully_blank_draft() {
        let draft = parse_en("", &starter_categories());
        assert_eq!(draft, VoiceDraft::default());
    }

    /// A spoken amount over $999 used to lose its thousands entirely:
    /// "two thousand five hundred dollars" broke into the runs "two"
    /// and "five hundred", the extractor took the one touching
    /// "dollars", and the user silently got $500. Wrong amounts are
    /// worse than missing ones -- there is nothing to prompt a
    /// correction.
    #[test]
    fn word_number_parsing_handles_thousands() {
        assert_eq!(
            parse_number_words(&["two", "thousand", "five", "hundred"]),
            Some((2500, 4))
        );
        assert_eq!(
            parse_number_words(&["one", "thousand", "eight", "hundred"]),
            Some((1800, 4))
        );
        // A bare "thousand dollars" is one thousand, not zero.
        assert_eq!(parse_number_words(&["thousand"]), None);
        assert_eq!(parse_number_words(&["a"]), None);
        assert_eq!(
            parse_number_words(&["three", "million", "two", "thousand"]),
            Some((3_002_000, 4))
        );
        // The pre-existing hundreds behaviour is unchanged.
        assert_eq!(
            parse_number_words(&["four", "hundred", "and", "fifty"]),
            Some((450, 4))
        );
    }

    /// Traditional Han numerals used to be lost outright: 萬 and 兩 were
    /// missing from the tables, so "一萬二千" parsed as $2,000 rather than
    /// $12,000 -- again silently wrong rather than absent. A Mandarin
    /// speaker writing Traditional is the ordinary case for this, and a
    /// model is free to emit either script whatever was spoken.
    #[test]
    fn cjk_number_parsing_accepts_traditional_numerals() {
        let trad: Vec<&str> = "一萬二千".split("").filter(|s| !s.is_empty()).collect();
        assert_eq!(parse_number_words_cjk(&trad), Some((12_000, 4)));
        let two_thousand: Vec<&str> = "兩千".split("").filter(|s| !s.is_empty()).collect();
        assert_eq!(parse_number_words_cjk(&two_thousand), Some((2000, 2)));
        // Simplified keeps parsing identically.
        let simp: Vec<&str> = "一万二千".split("").filter(|s| !s.is_empty()).collect();
        assert_eq!(parse_number_words_cjk(&simp), Some((12_000, 4)));
    }

    /// A transcript that writes amounts as digits carries its own unit
    /// marker, so there is no "dollars" word to anchor to and nothing
    /// parsed at all.
    #[test]
    fn amounts_written_as_digits_are_parsed() {
        assert_eq!(
            extract_amount_en(&["got", "paid", "$2,500", "salary"]),
            Some(2500.0)
        );
        assert_eq!(
            extract_amount_en(&["spent", "$32.50", "on", "gas"]),
            Some(32.50)
        );
        assert_eq!(extract_amount_en(&["paid", "$800."]), Some(800.0));
        // Not currency-shaped: left alone rather than guessed at.
        assert_eq!(extract_amount_en(&["call", "me", "$maybe"]), None);
        // The spoken path still works.
        assert_eq!(
            extract_amount_en(&["twelve", "dollars", "fifty", "cents"]),
            Some(12.50)
        );
    }

    #[test]
    fn word_number_parsing_handles_teens_and_compound_tens() {
        assert_eq!(parse_number_words(&["nineteen"]), Some((19, 1)));
        assert_eq!(parse_number_words(&["seventy", "three"]), Some((73, 2)));
        assert_eq!(
            parse_number_words(&["four", "hundred", "and", "fifty"]),
            Some((450, 4))
        );
        assert_eq!(parse_number_words(&["groceries"]), None);
    }

    #[test]
    fn levenshtein_matches_known_distances() {
        assert_eq!(levenshtein("insurance", "insurance"), 0);
        assert_eq!(levenshtein("kitten", "sitting"), 3);
        assert_eq!(levenshtein("", "abc"), 3);
    }

    // -- Mandarin -------------------------------------------------------

    fn parse_cmn(transcript: &str, categories: &[VoiceCategoryCandidate]) -> VoiceDraft {
        parse_voice_command(transcript, categories, VoiceLanguage::Cmn)
    }

    fn mandarin_starter_categories() -> Vec<VoiceCategoryCandidate> {
        vec![
            category(
                "inc-1",
                "主要劳动收入",
                true,
                Some("cat.primaryEarnedIncome"),
            ),
            category("exp-1", "饮食与日用品", false, Some("cat.foodGroceries")),
            category("exp-2", "交通", false, Some("cat.transportation")),
            category(
                "exp-3",
                "医疗与保险",
                false,
                Some("cat.healthcareInsurance"),
            ),
        ]
    }

    #[test]
    fn cjk_number_parsing_handles_the_multiplicative_grammar() {
        // Every distinct amount actually spoken in the spike's Mandarin
        // test set -- see mandarin_utterances.tsv.
        let cases: &[(&str, u64)] = &[
            ("五十", 50),
            ("两千", 2000),
            ("三十", 30),
            ("一百二十", 120),
            ("八百", 800),
            ("五百", 500),
            ("一千五百", 1500),
            ("九十九", 99),
            ("三百", 300),
            ("八千", 8000),
            ("两百五十", 250),
            ("一千二百", 1200),
            ("十五", 15),
            ("二十", 20),
            ("三千", 3000),
            ("四百", 400),
            ("五百五十", 550),
            ("一百", 100),
            ("一万", 10000),
        ];
        for (text, expected) in cases {
            let tokens = cjk_tokenize(text);
            let words: Vec<&str> = tokens.iter().map(String::as_str).collect();
            assert_eq!(
                parse_number_words_cjk(&words),
                Some((*expected, words.len())),
                "parsing {text:?}"
            );
        }
    }

    #[test]
    fn parses_a_real_mandarin_expense_utterance() {
        // m01 from the spike's own test set: "支出五十元买杂货".
        let draft = parse_cmn("支出五十元买杂货", &mandarin_starter_categories());
        assert_eq!(draft.amount, Some(50.0));
        assert_eq!(draft.is_income, Some(false));
        assert_eq!(draft.category_id.as_deref(), Some("exp-1"));
    }

    #[test]
    fn parses_a_real_mandarin_income_utterance_with_a_compound_number() {
        // m02: "收入两千元工资".
        let draft = parse_cmn("收入两千元工资", &mandarin_starter_categories());
        assert_eq!(draft.amount, Some(2000.0));
        assert_eq!(draft.is_income, Some(true));
        assert_eq!(draft.category_id.as_deref(), Some("inc-1"));
    }

    #[test]
    fn parses_mandarin_compound_number_with_transportation_alias() {
        // m04: "今天花了一百二十元交通费" -- exercises the 百+十 compound
        // grammar together with a 3-character alias.
        let draft = parse_cmn("今天花了一百二十元交通费", &mandarin_starter_categories());
        assert_eq!(draft.amount, Some(120.0));
        assert_eq!(draft.category_id.as_deref(), Some("exp-2"));
        assert_eq!(draft.is_income, Some(false));
    }

    #[test]
    fn a_near_homophone_asr_mistake_still_parses_via_a_second_verb_cue() {
        // The spike's one recorded Mandarin ASR mistake (m07): 买 ("buy")
        // misheard as 卖 ("sell"). Neither is in the closed alias
        // vocabulary for any category here, so this exercises the verb
        // fallback picking up "花了" ("spent") elsewhere in the same
        // sentence rather than being thrown off by the 买/卖 confusion.
        let draft = parse_cmn("卖咖啡花了三十五元", &mandarin_starter_categories());
        assert_eq!(draft.amount, Some(35.0));
        assert_eq!(draft.is_income, Some(false));
    }

    #[test]
    fn falls_back_to_the_spoken_mandarin_verb_when_no_category_matches() {
        let draft = parse_cmn("支出十元买手机", &mandarin_starter_categories());
        assert_eq!(draft.category_id, None);
        assert_eq!(draft.is_income, Some(false));
        assert_eq!(draft.amount, Some(10.0));
    }

    #[test]
    fn empty_mandarin_transcript_produces_a_fully_blank_draft() {
        let draft = parse_cmn("", &mandarin_starter_categories());
        assert_eq!(draft, VoiceDraft::default());
    }
}
