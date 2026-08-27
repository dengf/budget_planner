//! Foundational types shared by `budget_calc` and `budget_wasm`.
//!
//! Deliberately small: the vocabulary every layer above needs to agree on
//! (cadence, region, rounding, errors), and nothing else. No dependency on
//! the calculation logic itself -- see `budget-calc`.

mod cadence;
mod error;
mod message;
mod region;
mod rounding;

pub use cadence::Cadence;
pub use error::BudgetError;
pub use message::Message;
pub use region::Region;
pub use rounding::round_currency;

pub type BudgetResult<T> = Result<T, BudgetError>;
