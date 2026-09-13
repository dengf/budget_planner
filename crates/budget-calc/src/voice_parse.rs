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
//! search space.
//!
//! **Why the category's own `is_income` outranks the spoken verb.** The
//! spike's only two failures were a confidently wrong *category*, never a
//! wrong direction or amount -- so direction is derived from whichever
//! category matched, not re-guessed from "add income"/"add expense",
//! which a mishearing could just as easily invert. The verb is only a
//! fallback when no category matched at all.
//!
//! **Why amounts are anchored to "dollars"/"cents", not scanned freely.**
//! A number word appearing anywhere in the sentence is ambiguous (a
//! category name could itself contain one); anchoring to the unit word
//! immediately before/after it is the same "narrow the search space"
//! principle as the category matching above.

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

/// Extra spoken aliases per starter category, keyed by `preset_key`.
/// English-only for now -- see the module-level note on scope.
fn aliases_for_preset(preset_key: &str) -> &'static [&'static str] {
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
        let word = word.trim_end_matches(',');
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
        } else if word == "and" && saw_any {
            // "four hundred and fifty" -- skip the joiner, keep scanning.
            consumed += 1;
        } else {
            break;
        }
        total = current;
    }

    if saw_any {
        Some((total, consumed))
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

/// Looks for a number anchored immediately before a "dollars"/"cents"
/// unit word (in either spoken order: "twelve dollars" or, for the cents
/// half, "fifty cents"), and returns dollars-plus-cents as a single
/// amount. A lone dollar amount with no cents mentioned is fine; cents
/// with no dollar amount is treated as a whole-cents-only amount.
fn extract_amount(words: &[&str]) -> Option<f64> {
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
    (alias_len / 4).max(1)
}

/// Best (lowest-distance) match of `alias` against any contiguous run of
/// 1..=3 transcript words, joined with no spaces -- recovers a word the
/// model split in two ("in surance" vs "insurance") without needing a
/// dictionary of every possible split point.
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
) -> Option<&'a VoiceCategoryCandidate> {
    let mut best: Option<(&VoiceCategoryCandidate, usize)> = None;

    for category in categories {
        let mut aliases: Vec<String> = vec![category.name.to_lowercase()];
        if let Some(key) = &category.preset_key {
            aliases.extend(aliases_for_preset(key).iter().map(ToString::to_string));
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

/// Parses a raw transcript into a transaction draft. `categories` should
/// be every category currently in the budget -- see `CategoryDto`.
pub fn parse_voice_command(transcript: &str, categories: &[VoiceCategoryCandidate]) -> VoiceDraft {
    let lower = transcript.to_lowercase();
    let words: Vec<&str> = lower.split_whitespace().collect();

    let amount = extract_amount(&words);
    let matched = match_category(&words, categories);

    let is_income = if let Some(category) = matched {
        Some(category.is_income)
    } else {
        // No category matched at all -- fall back to whatever verb
        // was spoken, purely as a last resort (see module doc for
        // why a matched category always outranks this).
        let mut verb_income = None;
        for w in &words {
            if *w == "income" {
                verb_income = Some(true);
            } else if *w == "expense" || *w == "expenses" {
                verb_income = Some(false);
            }
        }
        verb_income
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

    #[test]
    fn parses_a_clean_expense_with_a_whole_dollar_amount() {
        let draft = parse_voice_command(
            "add expense twelve dollars groceries",
            &starter_categories(),
        );
        assert_eq!(draft.amount, Some(12.0));
        assert_eq!(draft.is_income, Some(false));
        assert_eq!(draft.category_id.as_deref(), Some("exp-1"));
    }

    #[test]
    fn parses_a_clean_income_with_an_alias_word() {
        let draft = parse_voice_command(
            "add income four hundred fifty dollars salary",
            &starter_categories(),
        );
        assert_eq!(draft.amount, Some(450.0));
        assert_eq!(draft.is_income, Some(true));
        assert_eq!(draft.category_id.as_deref(), Some("inc-1"));
    }

    #[test]
    fn parses_dollars_and_cents_together() {
        let draft = parse_voice_command(
            "add expense four dollars fifty cents transportation",
            &starter_categories(),
        );
        assert_eq!(draft.amount, Some(4.5));
        assert_eq!(draft.category_id.as_deref(), Some("exp-2"));
    }

    #[test]
    fn recovers_a_word_the_model_split_in_two() {
        // The spike's own recorded ASR mistake: "insurance" -> "in surance".
        let draft = parse_voice_command(
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
        let draft = parse_voice_command("add expense twenty dollars death", &starter_categories());
        assert_eq!(draft.category_id, None);
    }

    #[test]
    fn category_direction_overrides_a_possibly_misheard_verb() {
        // "add income" is heard, but "salary" only exists as an income
        // category here -- direction should still come from the category.
        let draft = parse_voice_command("add expense ten dollars salary", &starter_categories());
        assert_eq!(draft.is_income, Some(true));
    }

    #[test]
    fn falls_back_to_the_spoken_verb_when_no_category_matches() {
        let draft = parse_voice_command("add expense ten dollars zzz", &starter_categories());
        assert_eq!(draft.category_id, None);
        assert_eq!(draft.is_income, Some(false));
    }

    #[test]
    fn no_amount_leaves_amount_blank_rather_than_guessing() {
        let draft = parse_voice_command("add expense groceries", &starter_categories());
        assert_eq!(draft.amount, None);
        assert_eq!(draft.category_id.as_deref(), Some("exp-1"));
    }

    #[test]
    fn a_renamed_category_still_matches_on_its_own_name_with_no_preset_key() {
        let categories = vec![category("custom-1", "Coffee Fund", false, None)];
        let draft = parse_voice_command("add expense five dollars coffee fund", &categories);
        assert_eq!(draft.category_id.as_deref(), Some("custom-1"));
    }

    #[test]
    fn empty_transcript_produces_a_fully_blank_draft() {
        let draft = parse_voice_command("", &starter_categories());
        assert_eq!(draft, VoiceDraft::default());
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
}
