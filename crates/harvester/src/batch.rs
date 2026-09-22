/// Stand-in virtual size until the harvest transaction is measured.
const HARVEST_TX_BASE_VBYTES: u64 = 1_000;
const HARVEST_TX_PER_VAULT_VBYTES: u64 = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FeeBatch {
    pub count: usize,
    pub total_amount: u64,
    pub tx_fee: u64,
}

impl FeeBatch {
    const EMPTY: Self = Self {
        count: 0,
        total_amount: 0,
        tx_fee: 0,
    };
}

#[derive(Debug, Clone, Copy)]
pub struct TxCost {
    base_vbytes: u64,
    per_vault_vbytes: u64,
    fee_rate: u64,
}

impl TxCost {
    pub fn new(base_vbytes: u64, per_vault_vbytes: u64, fee_rate: u64) -> Self {
        Self {
            base_vbytes,
            per_vault_vbytes,
            fee_rate,
        }
    }

    pub fn harvest(fee_rate: u64) -> Self {
        Self::new(
            HARVEST_TX_BASE_VBYTES,
            HARVEST_TX_PER_VAULT_VBYTES,
            fee_rate,
        )
    }

    fn marginal_fee(self) -> Option<u64> {
        self.per_vault_vbytes.checked_mul(self.fee_rate)
    }

    fn fee(self, vault_count: u64) -> Option<u64> {
        let inputs = self.per_vault_vbytes.checked_mul(vault_count)?;
        let vbytes = self.base_vbytes.checked_add(inputs)?;
        vbytes.checked_mul(self.fee_rate)
    }
}

pub fn select_profitable(amounts_desc: &[u64], cost: TxCost, max_vaults: usize) -> FeeBatch {
    debug_assert!(
        amounts_desc.is_sorted_by(|left, right| left >= right),
        "vault amounts must be sorted descending"
    );

    let Some(marginal) = cost.marginal_fee() else {
        return FeeBatch::EMPTY;
    };

    let mut total_amount = 0u64;
    let mut count = 0usize;

    for &amount in amounts_desc.iter().take(max_vaults) {
        if amount <= marginal {
            break;
        }
        let Some(next_total) = total_amount.checked_add(amount) else {
            break;
        };
        total_amount = next_total;
        count += 1;
    }

    if count == 0 {
        return FeeBatch::EMPTY;
    }

    let Some(tx_fee) = cost.fee(count as u64) else {
        return FeeBatch::EMPTY;
    };
    if total_amount <= tx_fee {
        return FeeBatch::EMPTY;
    }

    FeeBatch {
        count,
        total_amount,
        tx_fee,
    }
}

#[cfg(test)]
mod tests {
    use super::{FeeBatch, TxCost, select_profitable};

    fn cost(base: u64, per_vault: u64, fee_rate: u64) -> TxCost {
        TxCost::new(base, per_vault, fee_rate)
    }

    #[test]
    fn takes_prefix_above_marginal_cost() {
        let batch = select_profitable(&[500, 400, 150, 100, 50], cost(100, 100, 1), 10);

        assert_eq!(
            batch,
            FeeBatch {
                count: 3,
                total_amount: 1_050,
                tx_fee: 400,
            }
        );
    }

    #[test]
    fn stops_at_max_vaults() {
        let batch = select_profitable(&[500, 400, 150], cost(100, 100, 1), 2);

        assert_eq!(
            batch,
            FeeBatch {
                count: 2,
                total_amount: 900,
                tx_fee: 300,
            }
        );
    }

    #[test]
    fn rejects_prefix_that_does_not_cover_the_base_fee() {
        let batch = select_profitable(&[500, 400, 150], cost(1_000, 100, 1), 10);

        assert_eq!(batch, FeeBatch::EMPTY);
    }

    #[test]
    fn rejects_batch_that_only_breaks_even() {
        let batch = select_profitable(&[100], cost(50, 50, 1), 10);

        assert_eq!(batch, FeeBatch::EMPTY);
    }

    #[test]
    fn takes_a_single_vault_that_covers_the_transaction() {
        let batch = select_profitable(&[2_000], cost(1_000, 100, 1), 10);

        assert_eq!(
            batch,
            FeeBatch {
                count: 1,
                total_amount: 2_000,
                tx_fee: 1_100,
            }
        );
    }

    #[test]
    fn zero_fee_rate_takes_every_positive_amount() {
        let batch = select_profitable(&[5, 1, 0], cost(1_000, 500, 0), 10);

        assert_eq!(
            batch,
            FeeBatch {
                count: 2,
                total_amount: 6,
                tx_fee: 0,
            }
        );
    }

    #[test]
    fn empty_input_selects_nothing() {
        let batch = select_profitable(&[], cost(100, 100, 1), 10);

        assert_eq!(batch, FeeBatch::EMPTY);
    }

    #[test]
    fn zero_cap_selects_nothing() {
        let batch = select_profitable(&[2_000], cost(100, 100, 1), 0);

        assert_eq!(batch, FeeBatch::EMPTY);
    }
}
