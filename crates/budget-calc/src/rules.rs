//! Categorization rules: the honest alternative to bank-linking auto-
//! categorization. A rule is a plain keyword match the person can read,
//! edit and delete -- never a model making a decision nobody can inspect.

use serde::{Deserialize, Serialize};

use budget_core::{BudgetError, BudgetResult};

use crate::transaction::Transaction;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CategorizationRule {
    pub id: String,
    /// Matched case-insensitively as a substring of the transaction
    /// description -- deliberately not a regex. A regex a bank statement
    /// can defeat with a stray special character is a worse bug than a
    /// substring match being slightly blunt.
    ///
    /// One field can hold several keywords separated by commas
    /// ("costco, walmart, target"); the rule matches if any one of them
    /// does. See [`keywords`](Self::keywords).
    pub keyword: String,
    pub category_id: String,
    /// Rules are tried in this order and the first match wins, so a
    /// specific rule ("NTUC FAIRPRICE" -> Groceries) can be placed ahead of
    /// a broad one ("NTUC" -> Utilities) rather than losing to whichever
    /// happened to be added first.
    pub priority: i32,
}

impl CategorizationRule {
    pub fn new(
        id: impl Into<String>,
        keyword: impl Into<String>,
        category_id: impl Into<String>,
        priority: i32,
    ) -> BudgetResult<Self> {
        let keyword = keyword.into();
        if split_keywords(&keyword).next().is_none() {
            return Err(BudgetError::BlankRuleKeyword);
        }
        Ok(Self {
            id: id.into(),
            keyword,
            category_id: category_id.into(),
            priority,
        })
    }

    /// The separate keywords this rule's field holds, trimmed, with empty
    /// pieces (a trailing comma, ", ,") dropped.
    pub fn keywords(&self) -> impl Iterator<Item = &str> {
        split_keywords(&self.keyword)
    }

    fn matches(&self, description: &str) -> bool {
        let description = description.to_lowercase();
        self.keywords()
            .any(|k| description.contains(&k.to_lowercase()))
    }
}

/// Splits on the ASCII comma and the full-width `，` a Chinese keyboard
/// types, so a list written in either language splits the same way.
/// Otherwise "全聯，家樂福" would be one keyword that no bank description
/// ever contains.
fn split_keywords(field: &str) -> impl Iterator<Item = &str> {
    field
        .split([',', '，'])
        .map(str::trim)
        .filter(|k| !k.is_empty())
}

/// Applies rules to every transaction that has no category yet.
///
/// Already-categorized transactions (a person's own correction) are left
/// alone -- rules never override a manual choice, only fill a gap. Rules
/// are tried highest-priority-first; ties keep list order, which is stable
/// under `sort_by`.
pub fn apply_rules(transactions: &mut [Transaction], rules: &[CategorizationRule]) {
    let mut ordered: Vec<&CategorizationRule> = rules.iter().collect();
    ordered.sort_by_key(|r| std::cmp::Reverse(r.priority));

    for t in transactions.iter_mut() {
        if t.category_id.is_some() {
            continue;
        }
        if let Some(rule) = ordered.iter().find(|r| r.matches(&t.description)) {
            t.category_id = Some(rule.category_id.clone());
        }
    }
}

/// The most words a suggested keyword is allowed to carry. Two is the
/// length of an actual merchant name ("whole foods", "ntuc fairprice")
/// once the branch and reference tokens are gone; three starts pulling in
/// the branch ("ntuc fairprice jurong"), which makes the rule match one
/// shop instead of the chain.
const MAX_KEYWORD_WORDS: usize = 2;

/// A keyword to propose when someone asks to make a rule out of a
/// transaction they are looking at.
///
/// Bank descriptions are a merchant name followed by noise: a branch
/// number, a terminal id, a reference code ("STARBUCKS #4021 SINGAPORE",
/// "GRAB *TRANSPORT 5F2A9", "AMZN Mktp US*2X4B81"). The merchant name is
/// the part worth matching on, and it is reliably at the front, so this
/// takes leading words and stops at the first one carrying a digit or a
/// reference marker (`*`, `#`).
///
/// **This is a suggestion, and the caller must let it be edited before
/// saving.** The heuristic is deliberately blunt -- a statement that
/// leads with its own noise ("POS DEBIT 09/12 SHELL") will propose the
/// noise, and no word list this crate could carry would be complete
/// across banks and countries. A wrong suggestion someone can see and fix
/// in the field costs a moment; a rule written silently from a wrong
/// guess miscategorizes every future import.
///
/// Lowercased, because matching is case-insensitive anyway
/// (`CategorizationRule::matches`) and a stored keyword that shouts back
/// in a bank statement's caps reads like a defect. `None` when nothing
/// usable survives -- a description that is only digits and symbols gives
/// no keyword worth proposing, and an empty rule would match everything.
pub fn suggest_rule_keyword(description: &str) -> Option<String> {
    let mut words: Vec<String> = Vec::new();

    for raw in description.split_whitespace() {
        // Reference markers attach to the token they spoil, so a token
        // carrying one is where the merchant name ended.
        if raw.contains('*') || raw.contains('#') || raw.chars().any(|c| c.is_ascii_digit()) {
            break;
        }
        let word: String = raw
            .trim_matches(|c: char| !c.is_alphanumeric())
            .to_lowercase();
        if word.is_empty() {
            break;
        }
        words.push(word);
        if words.len() == MAX_KEYWORD_WORDS {
            break;
        }
    }

    if words.is_empty() {
        return None;
    }
    Some(words.join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    fn rule(keyword: &str, category: &str, priority: i32) -> CategorizationRule {
        CategorizationRule::new("r", keyword, category, priority).unwrap()
    }

    fn tx(desc: &str) -> Transaction {
        Transaction::new("t", "2026-08-01", desc, dec!(-10))
    }

    #[test]
    fn a_blank_keyword_is_rejected() {
        assert_eq!(
            CategorizationRule::new("r", "  ", "dining", 0),
            Err(BudgetError::BlankRuleKeyword)
        );
    }

    #[test]
    fn a_keyword_field_of_only_commas_is_rejected() {
        // It splits into nothing, and nothing would match nothing -- a
        // rule that can never fire is a mistake worth saying out loud.
        assert_eq!(
            CategorizationRule::new("r", " , ，", "dining", 0),
            Err(BudgetError::BlankRuleKeyword)
        );
    }

    #[test]
    fn any_one_of_several_comma_separated_keywords_matches() {
        let rules = [rule("costco, walmart,target", "groceries", 0)];
        let mut txs = vec![
            tx("WALMART #12"),
            tx("TARGET T-100"),
            tx("COSTCO WHSE"),
            tx("SHELL"),
        ];
        apply_rules(&mut txs, &rules);
        let got: Vec<_> = txs.iter().map(|t| t.category_id.as_deref()).collect();
        assert_eq!(
            got,
            [
                Some("groceries"),
                Some("groceries"),
                Some("groceries"),
                None
            ]
        );
    }

    #[test]
    fn a_full_width_comma_separates_keywords_too() {
        let mut txs = vec![tx("家樂福 新店")];
        apply_rules(&mut txs, &[rule("全聯，家樂福", "groceries", 0)]);
        assert_eq!(txs[0].category_id, Some("groceries".to_string()));
    }

    #[test]
    fn empty_pieces_between_commas_never_match_everything() {
        // "costco,,": an empty piece is a substring of every description,
        // so it must be dropped, not matched.
        let mut txs = vec![tx("SHELL")];
        apply_rules(&mut txs, &[rule("costco, ,", "groceries", 0)]);
        assert_eq!(txs[0].category_id, None);
    }

    #[test]
    fn a_rule_can_file_into_a_subcategory() {
        // A rule stores a category id and nothing more, so a subcategory's
        // id is as good as a group's; the month's roll-up then counts it
        // under its group (`group_planned` / `build_month`).
        let mut txs = vec![tx("NTUC FAIRPRICE")];
        apply_rules(&mut txs, &[rule("fairprice", "sub-groceries", 0)]);
        assert_eq!(txs[0].category_id, Some("sub-groceries".to_string()));
    }

    #[test]
    fn matches_case_insensitively_as_a_substring() {
        let mut txs = vec![tx("STARBUCKS #4021 SINGAPORE")];
        apply_rules(&mut txs, &[rule("starbucks", "dining", 0)]);
        assert_eq!(txs[0].category_id, Some("dining".to_string()));
    }

    #[test]
    fn higher_priority_rule_wins_over_a_broader_one() {
        let mut txs = vec![tx("NTUC FAIRPRICE JURONG")];
        let rules = vec![
            rule("ntuc", "utilities", 0),
            rule("ntuc fairprice", "groceries", 10),
        ];
        apply_rules(&mut txs, &rules);
        assert_eq!(txs[0].category_id, Some("groceries".to_string()));
    }

    #[test]
    fn a_manually_set_category_is_never_overridden() {
        let mut txs = vec![tx("STARBUCKS")];
        txs[0].category_id = Some("gifts".to_string());
        apply_rules(&mut txs, &[rule("starbucks", "dining", 100)]);
        assert_eq!(txs[0].category_id, Some("gifts".to_string()));
    }

    #[test]
    fn no_match_leaves_the_transaction_uncategorized() {
        let mut txs = vec![tx("UNKNOWN MERCHANT XYZ")];
        apply_rules(&mut txs, &[rule("starbucks", "dining", 0)]);
        assert_eq!(txs[0].category_id, None);
    }

    fn suggested(description: &str) -> Option<String> {
        suggest_rule_keyword(description)
    }

    #[test]
    fn a_branch_number_ends_the_merchant_name() {
        assert_eq!(
            suggested("STARBUCKS #4021 SINGAPORE"),
            Some("starbucks".to_string())
        );
    }

    #[test]
    fn a_reference_marker_ends_the_merchant_name() {
        assert_eq!(suggested("GRAB *TRANSPORT 5F2A9"), Some("grab".to_string()));
        assert_eq!(
            suggested("AMZN Mktp US*2X4B81"),
            Some("amzn mktp".to_string())
        );
    }

    #[test]
    fn a_two_word_merchant_survives_whole() {
        assert_eq!(
            suggested("WHOLE FOODS MARKET"),
            Some("whole foods".to_string())
        );
    }

    #[test]
    fn a_long_name_stops_before_the_branch() {
        // Three words would be "ntuc fairprice jurong", which matches one
        // shop instead of the chain.
        assert_eq!(
            suggested("NTUC FAIRPRICE JURONG POINT"),
            Some("ntuc fairprice".to_string())
        );
    }

    #[test]
    fn a_hand_typed_note_is_left_as_it_is() {
        assert_eq!(suggested("Coffee"), Some("coffee".to_string()));
    }

    #[test]
    fn surrounding_punctuation_is_trimmed_off_a_word() {
        assert_eq!(suggested("(SHELL) OIL"), Some("shell oil".to_string()));
    }

    #[test]
    fn a_description_with_no_usable_word_suggests_nothing() {
        // An empty keyword would match every transaction ever imported.
        assert_eq!(suggested("4021 #99"), None);
        assert_eq!(suggested(""), None);
        assert_eq!(suggested("   "), None);
    }

    #[test]
    fn a_suggested_keyword_actually_matches_the_transaction_it_came_from() {
        // The round trip that matters: whatever this proposes must file
        // the very transaction someone made the rule from.
        for description in [
            "STARBUCKS #4021 SINGAPORE",
            "GRAB *TRANSPORT 5F2A9",
            "NTUC FAIRPRICE JURONG POINT",
            "Coffee",
        ] {
            let keyword = suggested(description).expect(description);
            let mut txs = vec![tx(description)];
            apply_rules(&mut txs, &[rule(&keyword, "dining", 0)]);
            assert_eq!(
                txs[0].category_id,
                Some("dining".to_string()),
                "keyword {keyword:?} did not match {description:?}"
            );
        }
    }
}
