//! [`budget_ports::BudgetStore`] implemented on top of `redb`.
//!
//! Same split as mortgage_calculator's `mortgage-ext-redb`: the table
//! logic (schema, save/list/delete) is identical on every platform, and
//! only *how the bytes get durable* differs --
//!
//! - Native targets ([`native`]): `redb`'s ordinary file backend.
//! - `wasm32` ([`wasm`]): a custom [`redb::StorageBackend`] backed by an
//!   in-memory buffer, asynchronously flushed to the browser's IndexedDB.
//!
//! Six record types share one `redb::Database`, one table per type, all
//! keyed by the record's own `id`. A macro generates the six
//! save/list/delete implementations rather than hand-writing them --
//! they are structurally identical (see [`mortgage-ext-redb`]'s
//! single-entity version for what one of these looks like written out),
//! and six independent copies is exactly the kind of duplication that
//! drifts.

#[cfg(not(target_arch = "wasm32"))]
pub mod native;
#[cfg(target_arch = "wasm32")]
pub mod wasm;

#[cfg(any(test, target_arch = "wasm32"))]
mod buffer;

use async_trait::async_trait;
use redb::{Database, ReadableDatabase, ReadableTable, TableDefinition};
use serde::{de::DeserializeOwned, Serialize};

use budget_ports::{
    BudgetPlanRecord, BudgetStore, CategorizationRuleRecord, CategoryRecord, DebtRecord,
    GoalRecord, StoreError, TransactionRecord,
};

/// Shared [`BudgetStore`] implementation over an already-open
/// [`redb::Database`], regardless of what [`redb::StorageBackend`] backs
/// it.
pub struct RedbBudgetStore {
    db: Database,
}

impl RedbBudgetStore {
    fn from_database(db: Database) -> Self {
        Self { db }
    }

    fn backend_err(e: impl std::fmt::Display) -> StoreError {
        StoreError::Backend(e.to_string())
    }

    fn serialization_err(e: impl std::fmt::Display) -> StoreError {
        StoreError::Serialization(e.to_string())
    }

    fn save_record<T: Serialize>(
        &self,
        table: TableDefinition<&str, &[u8]>,
        id: &str,
        record: &T,
    ) -> Result<(), StoreError> {
        let bytes = serde_json::to_vec(record).map_err(Self::serialization_err)?;
        let write_txn = self.db.begin_write().map_err(Self::backend_err)?;
        {
            let mut table = write_txn.open_table(table).map_err(Self::backend_err)?;
            table
                .insert(id, bytes.as_slice())
                .map_err(Self::backend_err)?;
        }
        write_txn.commit().map_err(Self::backend_err)?;
        Ok(())
    }

    fn list_records<T: DeserializeOwned>(
        &self,
        table: TableDefinition<&str, &[u8]>,
    ) -> Result<Vec<T>, StoreError> {
        let read_txn = self.db.begin_read().map_err(Self::backend_err)?;
        let table = match read_txn.open_table(table) {
            Ok(table) => table,
            Err(redb::TableError::TableDoesNotExist(_)) => return Ok(Vec::new()),
            Err(e) => return Err(Self::backend_err(e)),
        };

        let mut records = Vec::new();
        for entry in table.iter().map_err(Self::backend_err)? {
            let (_, value) = entry.map_err(Self::backend_err)?;
            records.push(serde_json::from_slice(value.value()).map_err(Self::serialization_err)?);
        }
        Ok(records)
    }

    fn delete_record(
        &self,
        table: TableDefinition<&str, &[u8]>,
        id: &str,
    ) -> Result<(), StoreError> {
        let write_txn = self.db.begin_write().map_err(Self::backend_err)?;
        {
            let mut table = write_txn.open_table(table).map_err(Self::backend_err)?;
            table.remove(id).map_err(Self::backend_err)?;
        }
        write_txn.commit().map_err(Self::backend_err)?;
        Ok(())
    }
}

/// Generates one `BudgetStore` save/list/delete trio, all delegating to
/// the generic helpers above with a fixed table and record type.
macro_rules! collection {
    ($table_const:ident, $table_name:literal, $save:ident, $list:ident, $delete:ident, $record:ty) => {
        const $table_const: TableDefinition<&str, &[u8]> = TableDefinition::new($table_name);

        async fn $save(store: &RedbBudgetStore, record: $record) -> Result<(), StoreError> {
            store.save_record($table_const, &record.id.clone(), &record)
        }
        async fn $list(store: &RedbBudgetStore) -> Result<Vec<$record>, StoreError> {
            store.list_records($table_const)
        }
        async fn $delete(store: &RedbBudgetStore, id: &str) -> Result<(), StoreError> {
            store.delete_record($table_const, id)
        }
    };
}

collection!(
    CATEGORIES,
    "categories",
    save_category_impl,
    list_categories_impl,
    delete_category_impl,
    CategoryRecord
);
collection!(
    BUDGET_PLAN,
    "budget_plan",
    save_budget_plan_impl,
    list_budget_plan_all_impl,
    delete_budget_plan_impl,
    BudgetPlanRecord
);
collection!(
    TRANSACTIONS,
    "transactions",
    save_transaction_impl,
    list_transactions_impl,
    delete_transaction_impl,
    TransactionRecord
);
collection!(
    GOALS,
    "goals",
    save_goal_impl,
    list_goals_impl,
    delete_goal_impl,
    GoalRecord
);
collection!(
    DEBTS,
    "debts",
    save_debt_impl,
    list_debts_impl,
    delete_debt_impl,
    DebtRecord
);
collection!(
    RULES,
    "categorization_rules",
    save_rule_impl,
    list_rules_impl,
    delete_rule_impl,
    CategorizationRuleRecord
);

#[async_trait(?Send)]
impl BudgetStore for RedbBudgetStore {
    async fn save_category(&self, record: CategoryRecord) -> Result<(), StoreError> {
        save_category_impl(self, record).await
    }
    async fn list_categories(&self) -> Result<Vec<CategoryRecord>, StoreError> {
        list_categories_impl(self).await
    }
    async fn delete_category(&self, id: &str) -> Result<(), StoreError> {
        delete_category_impl(self, id).await
    }

    async fn save_budget_plan(&self, record: BudgetPlanRecord) -> Result<(), StoreError> {
        save_budget_plan_impl(self, record).await
    }
    async fn list_budget_plan(&self, month: &str) -> Result<Vec<BudgetPlanRecord>, StoreError> {
        // Filtering to one month is cheap and in-memory; no reason to keep
        // a table per month, which would turn "show me last month too"
        // into a schema question.
        Ok(list_budget_plan_all_impl(self)
            .await?
            .into_iter()
            .filter(|r| r.month == month)
            .collect())
    }
    async fn delete_budget_plan(&self, id: &str) -> Result<(), StoreError> {
        delete_budget_plan_impl(self, id).await
    }

    async fn save_transaction(&self, record: TransactionRecord) -> Result<(), StoreError> {
        save_transaction_impl(self, record).await
    }
    async fn list_transactions(&self) -> Result<Vec<TransactionRecord>, StoreError> {
        list_transactions_impl(self).await
    }
    async fn delete_transaction(&self, id: &str) -> Result<(), StoreError> {
        delete_transaction_impl(self, id).await
    }

    async fn save_goal(&self, record: GoalRecord) -> Result<(), StoreError> {
        save_goal_impl(self, record).await
    }
    async fn list_goals(&self) -> Result<Vec<GoalRecord>, StoreError> {
        list_goals_impl(self).await
    }
    async fn delete_goal(&self, id: &str) -> Result<(), StoreError> {
        delete_goal_impl(self, id).await
    }

    async fn save_debt(&self, record: DebtRecord) -> Result<(), StoreError> {
        save_debt_impl(self, record).await
    }
    async fn list_debts(&self) -> Result<Vec<DebtRecord>, StoreError> {
        list_debts_impl(self).await
    }
    async fn delete_debt(&self, id: &str) -> Result<(), StoreError> {
        delete_debt_impl(self, id).await
    }

    async fn save_rule(&self, record: CategorizationRuleRecord) -> Result<(), StoreError> {
        save_rule_impl(self, record).await
    }
    async fn list_rules(&self) -> Result<Vec<CategorizationRuleRecord>, StoreError> {
        list_rules_impl(self).await
    }
    async fn delete_rule(&self, id: &str) -> Result<(), StoreError> {
        delete_rule_impl(self, id).await
    }
}
