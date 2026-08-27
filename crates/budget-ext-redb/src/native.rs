//! Native construction: a plain `redb` file on disk.

use std::path::Path;

use budget_ports::StoreError;
use redb::Builder;

use crate::RedbBudgetStore;

/// redb defaults to a 1 GiB cache ceiling, sized for large server-side
/// databases. A household's budget data -- transactions, categories,
/// goals, debts -- is thousands of small JSON records at most; a few MiB
/// is generous headroom, and a more predictable ceiling on
/// memory-constrained mobile targets.
const CACHE_SIZE_BYTES: usize = 4 * 1024 * 1024;

impl RedbBudgetStore {
    /// Opens (or creates) a redb file at `path`.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let db = Builder::new()
            .set_cache_size(CACHE_SIZE_BYTES)
            .create(path.as_ref())
            .map_err(|e| StoreError::Backend(e.to_string()))?;
        Ok(Self::from_database(db))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use budget_ports::{BudgetStore, CategoryRecord, TransactionRecord};

    fn category(id: &str, name: &str) -> CategoryRecord {
        CategoryRecord {
            id: id.to_string(),
            name: name.to_string(),
            group: "Living".to_string(),
            is_income: false,
        }
    }

    fn transaction(id: &str, amount: &str) -> TransactionRecord {
        TransactionRecord {
            id: id.to_string(),
            date: "2026-08-01".to_string(),
            description: "Coffee".to_string(),
            amount: amount.to_string(),
            category_id: None,
        }
    }

    #[tokio::test]
    async fn save_list_delete_round_trip_for_categories() {
        let dir = tempfile::tempdir().unwrap();
        let store = RedbBudgetStore::open(dir.path().join("budget.redb")).unwrap();

        store.save_category(category("c1", "Dining")).await.unwrap();
        store.save_category(category("c2", "Rent")).await.unwrap();

        let all = store.list_categories().await.unwrap();
        assert_eq!(all.len(), 2);

        store.delete_category("c1").await.unwrap();
        let remaining = store.list_categories().await.unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, "c2");
    }

    #[tokio::test]
    async fn different_record_types_do_not_collide_in_storage() {
        let dir = tempfile::tempdir().unwrap();
        let store = RedbBudgetStore::open(dir.path().join("budget.redb")).unwrap();

        // Same id used across two different collections -- should not
        // overwrite or interfere, since each has its own table.
        store
            .save_category(category("shared-id", "Dining"))
            .await
            .unwrap();
        store
            .save_transaction(transaction("shared-id", "-5.00"))
            .await
            .unwrap();

        assert_eq!(store.list_categories().await.unwrap().len(), 1);
        assert_eq!(store.list_transactions().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn reopening_the_same_file_persists_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("budget.redb");

        {
            let store = RedbBudgetStore::open(&path).unwrap();
            store.save_category(category("c1", "Dining")).await.unwrap();
        }

        let store = RedbBudgetStore::open(&path).unwrap();
        let all = store.list_categories().await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].name, "Dining");
    }

    #[tokio::test]
    async fn budget_plan_lists_only_the_requested_month() {
        let dir = tempfile::tempdir().unwrap();
        let store = RedbBudgetStore::open(dir.path().join("budget.redb")).unwrap();

        store
            .save_budget_plan(budget_ports::BudgetPlanRecord {
                id: "p1".to_string(),
                month: "2026-07".to_string(),
                category_id: "dining".to_string(),
                planned: "200".to_string(),
            })
            .await
            .unwrap();
        store
            .save_budget_plan(budget_ports::BudgetPlanRecord {
                id: "p2".to_string(),
                month: "2026-08".to_string(),
                category_id: "dining".to_string(),
                planned: "220".to_string(),
            })
            .await
            .unwrap();

        let august = store.list_budget_plan("2026-08").await.unwrap();
        assert_eq!(august.len(), 1);
        assert_eq!(august[0].id, "p2");
    }
}
