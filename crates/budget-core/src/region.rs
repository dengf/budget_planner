use serde::{Deserialize, Serialize};

/// Which market's categories, currency label and CPF-aware goal buckets
/// apply. Mirrors `mortgage-core::Region` -- same two markets, same
/// reason: the numbers this app helps with (a monthly budget, a CPF
/// savings goal) genuinely differ by market, and detection lives in the
/// host layer (`www/src/region.js`-equivalent), never here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Region {
    Us,
    Sg,
}
