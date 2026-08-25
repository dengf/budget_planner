//! `wasm32` construction: `redb` running against a
//! [`redb::StorageBackend`] backed by an in-memory buffer, asynchronously
//! flushed to IndexedDB (via `rexie`) after each write and preloaded from
//! IndexedDB once at startup.
//!
//! Ported from mortgage_calculator's `mortgage-ext-redb::wasm`, which
//! explains the tradeoff at length: this deliberately does *not* use the
//! Origin Private File System's synchronous access handles (the approach
//! browser-native SQLite builds use) -- that API only exists inside a
//! dedicated Worker, which would mean restructuring the whole app around
//! a Worker/postMessage boundary just for storage. Keeping the working
//! set in memory and persisting it as a single blob is a well-understood
//! local-first tradeoff: writes are visible immediately and durable within
//! roughly one JS microtask, rather than fsync-before-return.

use std::cell::RefCell;
use std::io;
use std::rc::Rc;

use budget_ports::StoreError;
use redb::{Builder, StorageBackend};
use rexie::{ObjectStore, Rexie, TransactionMode};
use wasm_bindgen::JsValue;

use crate::buffer::InMemoryBuffer;
use crate::RedbBudgetStore;

const DB_NAME: &str = "budget_planner";
const STORE_NAME: &str = "redb_backend";
const BLOB_KEY: &str = "db";

/// A household's budget data is small even at years of transaction
/// history -- a few MiB is generous headroom for realistic scale and a
/// predictable ceiling on memory-constrained wasm targets.
const CACHE_SIZE_BYTES: usize = 4 * 1024 * 1024;

impl RedbBudgetStore {
    /// Loads any previously-persisted database bytes from IndexedDB, then
    /// opens (or initializes) redb against an in-memory-backed
    /// [`IndexedDbBackend`]. Must run before any other wasm-bindgen call
    /// touches storage.
    pub async fn open_wasm() -> Result<Self, StoreError> {
        let bytes = load_blob().await.map_err(StoreError::Backend)?;

        let backend = IndexedDbBackend {
            buffer: RefCell::new(InMemoryBuffer::new(bytes)),
            writer: Rc::new(PersistState::default()),
        };
        let db = Builder::new()
            .set_cache_size(CACHE_SIZE_BYTES)
            .create_with_backend(backend)
            .map_err(|e| StoreError::Backend(e.to_string()))?;

        Ok(Self::from_database(db))
    }
}

#[derive(Debug)]
struct IndexedDbBackend {
    buffer: RefCell<InMemoryBuffer>,
    writer: Rc<PersistState>,
}

/// Coalescing single-flight writer: at most one IndexedDB persist runs at
/// a time. A `sync_data()` call that lands while a flush is already in
/// progress just replaces `pending` with its (newer) snapshot rather than
/// opening a second, independent IndexedDB transaction -- two overlapping
/// writes have no ordering guarantee relative to each other, and the
/// older one finishing last would silently leave stale data as the final
/// state. `pending` is drained in a loop after each flush so the *latest*
/// snapshot always eventually wins.
#[derive(Debug, Default)]
struct PersistState {
    flushing: RefCell<bool>,
    pending: RefCell<Option<Vec<u8>>>,
}

// Safety: wasm32-unknown-unknown is single-threaded, so there is no actual
// concurrent access for these bounds to protect against -- they exist
// only because `redb::StorageBackend` requires them.
unsafe impl Send for IndexedDbBackend {}
unsafe impl Sync for IndexedDbBackend {}

impl StorageBackend for IndexedDbBackend {
    fn len(&self) -> Result<u64, io::Error> {
        Ok(self.buffer.borrow().len())
    }

    fn read(&self, offset: u64, out: &mut [u8]) -> Result<(), io::Error> {
        self.buffer.borrow().read(offset, out)
    }

    fn write(&self, offset: u64, data: &[u8]) -> Result<(), io::Error> {
        self.buffer.borrow_mut().write(offset, data)
    }

    fn set_len(&self, len: u64) -> Result<(), io::Error> {
        self.buffer.borrow_mut().set_len(len);
        Ok(())
    }

    fn sync_data(&self) -> Result<(), io::Error> {
        let snapshot = self.buffer.borrow().snapshot();

        if *self.writer.flushing.borrow() {
            *self.writer.pending.borrow_mut() = Some(snapshot);
            return Ok(());
        }

        *self.writer.flushing.borrow_mut() = true;
        spawn_flush_loop(self.writer.clone(), snapshot);
        Ok(())
    }
}

/// Persists `snapshot`, then keeps persisting whatever landed in `pending`
/// while that write was in flight, until nothing newer is waiting. wasm32
/// is single-threaded and this only yields at the `.await` inside
/// `persist_blob`, so there's no race between draining `pending` and
/// clearing `flushing`.
fn spawn_flush_loop(writer: Rc<PersistState>, mut snapshot: Vec<u8>) {
    wasm_bindgen_futures::spawn_local(async move {
        loop {
            if let Err(e) = persist_blob(snapshot).await {
                web_sys::console::error_1(&format!("budget-ext-redb: persist failed: {e}").into());
            }
            match writer.pending.borrow_mut().take() {
                Some(next) => snapshot = next,
                None => break,
            }
        }
        *writer.flushing.borrow_mut() = false;
    });
}

async fn open_object_store() -> Result<Rexie, String> {
    Rexie::builder(DB_NAME)
        .version(1)
        .add_object_store(ObjectStore::new(STORE_NAME))
        .build()
        .await
        .map_err(|e| e.to_string())
}

async fn load_blob() -> Result<Vec<u8>, String> {
    let rexie = open_object_store().await?;

    let txn = rexie
        .transaction(&[STORE_NAME], TransactionMode::ReadOnly)
        .map_err(|e| e.to_string())?;
    let store = txn.store(STORE_NAME).map_err(|e| e.to_string())?;

    let value = store
        .get(JsValue::from_str(BLOB_KEY))
        .await
        .map_err(|e| e.to_string())?;
    txn.done().await.map_err(|e| e.to_string())?;

    let Some(value) = value.filter(|v| !v.is_undefined() && !v.is_null()) else {
        return Ok(Vec::new());
    };
    Ok(js_sys::Uint8Array::new(&value).to_vec())
}

async fn persist_blob(bytes: Vec<u8>) -> Result<(), String> {
    let rexie = open_object_store().await?;

    let txn = rexie
        .transaction(&[STORE_NAME], TransactionMode::ReadWrite)
        .map_err(|e| e.to_string())?;
    let store = txn.store(STORE_NAME).map_err(|e| e.to_string())?;

    let array = js_sys::Uint8Array::from(bytes.as_slice());
    store
        .put(&array, Some(&JsValue::from_str(BLOB_KEY)))
        .await
        .map_err(|e| e.to_string())?;
    txn.done().await.map_err(|e| e.to_string())?;

    Ok(())
}
