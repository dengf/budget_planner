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
        if keyword.trim().is_empty() {
            return Err(BudgetError::BlankRuleKeyword);
        }
        Ok(Self {
            id: id.into(),
            keyword,
            category_id: category_id.into(),
            priority,
        })
    }

    fn matches(&self, description: &str) -> bool {
        description
            .to_lowercase()
            .contains(&self.keyword.to_lowercase())
    }
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
}
