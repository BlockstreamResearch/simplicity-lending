#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeeBatch<T> {
    pub count: usize,
    pub total_amount: u64,
    pub tx_fee: u64,
    pub transaction: T,
}

pub fn select_profitable<T, E>(
    amounts_desc: &[u64],
    max_vaults: usize,
    mut finalize_vault: impl FnMut(usize, u64) -> Result<Option<(T, u64)>, E>,
) -> Result<Option<FeeBatch<T>>, E> {
    debug_assert!(
        amounts_desc.is_sorted_by(|left, right| left >= right),
        "vault amounts must be sorted descending"
    );

    let mut total_amount = 0u64;
    let mut selected = 0usize;
    let mut best = None;
    let mut previous_profit = 0u64;

    for (index, &amount) in amounts_desc.iter().enumerate() {
        if selected >= max_vaults {
            break;
        }
        let Some(next_total) = total_amount.checked_add(amount) else {
            break;
        };
        let Some((transaction, tx_fee)) = finalize_vault(index, next_total)? else {
            continue;
        };

        let Some(profit) = next_total.checked_sub(tx_fee) else {
            break;
        };
        if profit <= previous_profit {
            break;
        }

        total_amount = next_total;
        previous_profit = profit;
        selected += 1;
        best = Some(FeeBatch {
            count: selected,
            total_amount,
            tx_fee,
            transaction,
        });
    }

    Ok(best)
}

#[cfg(test)]
mod tests {
    use std::convert::Infallible;

    use super::{FeeBatch, select_profitable};

    fn select(amounts: &[u64], fees: &[u64], max_vaults: usize) -> Option<FeeBatch<usize>> {
        select_profitable(amounts, max_vaults, |index, _| {
            Ok::<_, Infallible>(Some((index + 1, fees[index])))
        })
        .unwrap()
    }

    #[test]
    fn takes_prefix_while_each_vault_increases_profit() {
        let batch = select(&[500, 400, 150, 100, 50], &[200, 300, 400, 550, 600], 10);

        assert_eq!(
            batch,
            Some(FeeBatch {
                count: 3,
                total_amount: 1_050,
                tx_fee: 400,
                transaction: 3,
            })
        );
    }

    #[test]
    fn stops_at_max_vaults() {
        let batch = select(&[500, 400, 150], &[200, 300, 400], 2);

        assert_eq!(
            batch,
            Some(FeeBatch {
                count: 2,
                total_amount: 900,
                tx_fee: 300,
                transaction: 2,
            })
        );
    }

    #[test]
    fn rejects_prefix_that_does_not_cover_the_base_fee() {
        let batch = select(&[500, 400, 150], &[1_100, 1_200, 1_300], 10);

        assert_eq!(batch, None);
    }

    #[test]
    fn rejects_batch_that_only_breaks_even() {
        let batch = select(&[100], &[100], 10);

        assert_eq!(batch, None);
    }

    #[test]
    fn takes_a_single_vault_that_covers_the_transaction() {
        let batch = select(&[2_000], &[1_100], 10);

        assert_eq!(
            batch,
            Some(FeeBatch {
                count: 1,
                total_amount: 2_000,
                tx_fee: 1_100,
                transaction: 1,
            })
        );
    }

    #[test]
    fn stops_when_next_vault_only_covers_its_incremental_fee() {
        let batch = select(&[500, 100, 50], &[200, 300, 301], 10);

        assert_eq!(
            batch,
            Some(FeeBatch {
                count: 1,
                total_amount: 500,
                tx_fee: 200,
                transaction: 1,
            })
        );
    }

    #[test]
    fn empty_input_selects_nothing() {
        let batch = select(&[], &[], 10);

        assert_eq!(batch, None);
    }

    #[test]
    fn zero_cap_selects_nothing() {
        let batch = select(&[2_000], &[100], 0);

        assert_eq!(batch, None);
    }

    #[test]
    fn skips_a_vault_without_a_keeper_and_continues() {
        let batch = select_profitable(&[500, 400, 150], 10, |index, _| {
            Ok::<_, Infallible>(match index {
                0 => Some((1, 200)),
                1 => None,
                2 => Some((3, 280)),
                _ => panic!("vault {index} is past the profitability stop"),
            })
        })
        .unwrap();

        assert_eq!(
            batch,
            Some(FeeBatch {
                count: 2,
                total_amount: 650,
                tx_fee: 280,
                transaction: 3,
            })
        );
    }

    #[test]
    fn a_skipped_vault_does_not_consume_a_transaction_slot() {
        let batch = select_profitable(&[500, 400, 300, 200], 2, |index, _| {
            Ok::<_, Infallible>(match index {
                0 => None,
                1 => Some((2, 100)),
                2 => Some((3, 180)),
                _ => panic!("selection reached vault {index}"),
            })
        })
        .unwrap();

        assert_eq!(
            batch,
            Some(FeeBatch {
                count: 2,
                total_amount: 700,
                tx_fee: 180,
                transaction: 3,
            })
        );
    }

    #[test]
    fn stops_at_the_first_unprofitable_vault_after_a_skip() {
        let batch = select_profitable(&[500, 400, 150, 50], 10, |index, _| {
            Ok::<_, Infallible>(match index {
                0 => Some((1, 200)),
                1 => None,
                2 => Some((3, 450)),
                _ => panic!("vault {index} is past the profitability stop"),
            })
        })
        .unwrap();

        assert_eq!(
            batch,
            Some(FeeBatch {
                count: 1,
                total_amount: 500,
                tx_fee: 200,
                transaction: 1,
            })
        );
    }
}
