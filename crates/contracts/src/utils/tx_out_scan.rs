use simplex::simplicityhl::elements::{AssetId, Script, Transaction, TxOut};

/// Optional filters for scanning explicit transaction outputs.
#[derive(Debug, Clone, Copy, Default)]
pub struct TxOutFilter<'a> {
    pub asset: Option<AssetId>,
    pub amount: Option<u64>,
    /// Require `amount >= min_amount` (after explicit decode).
    pub min_amount: Option<u64>,
    pub script_pubkey: Option<&'a Script>,
    /// `Some(true)` — must be OP_RETURN; `Some(false)` — must not; `None` — either.
    pub require_op_return: Option<bool>,
}

impl<'a> TxOutFilter<'a> {
    pub const fn new() -> Self {
        Self {
            asset: None,
            amount: None,
            min_amount: None,
            script_pubkey: None,
            require_op_return: None,
        }
    }

    pub const fn asset(mut self, asset: AssetId) -> Self {
        self.asset = Some(asset);
        self
    }

    pub const fn amount(mut self, amount: u64) -> Self {
        self.amount = Some(amount);
        self
    }

    pub const fn min_amount(mut self, min_amount: u64) -> Self {
        self.min_amount = Some(min_amount);
        self
    }

    pub const fn script_pubkey(mut self, script_pubkey: &'a Script) -> Self {
        self.script_pubkey = Some(script_pubkey);
        self
    }

    pub const fn require_op_return(mut self, require_op_return: bool) -> Self {
        self.require_op_return = Some(require_op_return);
        self
    }
}

impl TxOutFilter<'_> {
    pub fn matches(&self, output: &TxOut) -> bool {
        let (Some(asset), Some(amount)) = (output.asset.explicit(), output.value.explicit()) else {
            return false;
        };

        if let Some(expected) = self.asset
            && asset != expected
        {
            return false;
        }

        if let Some(expected) = self.amount
            && amount != expected
        {
            return false;
        }

        if let Some(min) = self.min_amount
            && amount < min
        {
            return false;
        }

        if let Some(script) = self.script_pubkey
            && output.script_pubkey != *script
        {
            return false;
        }

        if let Some(require_op_return) = self.require_op_return
            && output.script_pubkey.is_op_return() != require_op_return
        {
            return false;
        }

        true
    }
}

/// Find the unique explicit output matching `filter`.
///
/// Returns `(vout, amount)` only when exactly one output matches.
pub fn find_unique_vout(tx: &Transaction, filter: TxOutFilter<'_>) -> Option<(u32, u64)> {
    let matches: Vec<(u32, u64)> = tx
        .output
        .iter()
        .enumerate()
        .filter_map(|(vout, output)| {
            if !filter.matches(output) {
                return None;
            }
            Some((vout as u32, output.value.explicit()?))
        })
        .collect();

    match matches.as_slice() {
        [(vout, amount)] => Some((*vout, *amount)),
        _ => None,
    }
}

/// Whether any explicit output matches `filter`.
pub fn has_matching_vout(tx: &Transaction, filter: TxOutFilter<'_>) -> bool {
    tx.output.iter().any(|output| filter.matches(output))
}
