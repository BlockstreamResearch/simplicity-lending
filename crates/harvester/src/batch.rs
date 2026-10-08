#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeeBatch<T> {
    pub count: usize,
    pub total_amount: u64,
    pub tx_fee: u64,
    pub transaction: T,
}

#[derive(Debug)]
pub enum BuildStep<T, E> {
    Ready { transaction: T, tx_fee: u64 },
    Skip,
    Stop(E),
}

pub fn build<T, E>(
    amounts: &[u64],
    min_vaults: usize,
    max_vaults: usize,
    mut finalize_vault: impl FnMut(usize, u64) -> Result<BuildStep<T, E>, E>,
) -> Result<Option<FeeBatch<T>>, E> {
    let mut total_amount = 0u64;
    let mut selected = 0usize;
    let mut batch = None;

    for (index, &amount) in amounts.iter().enumerate() {
        if selected >= max_vaults {
            break;
        }
        let Some(next_total) = total_amount.checked_add(amount) else {
            break;
        };

        match finalize_vault(index, next_total)? {
            BuildStep::Skip => continue,
            BuildStep::Stop(err) => {
                return match batch.filter(|batch: &FeeBatch<T>| batch.count >= min_vaults) {
                    Some(batch) => Ok(Some(batch)),
                    None => Err(err),
                };
            }
            BuildStep::Ready {
                transaction,
                tx_fee,
            } => {
                total_amount = next_total;
                selected += 1;
                batch = Some(FeeBatch {
                    count: selected,
                    total_amount,
                    tx_fee,
                    transaction,
                });
            }
        }
    }

    Ok(batch.filter(|batch| batch.count >= min_vaults))
}

#[cfg(test)]
mod tests {
    use std::convert::Infallible;

    use super::{BuildStep, FeeBatch, build};

    fn build_with(
        amounts: &[u64],
        fees: &[u64],
        min_vaults: usize,
        max_vaults: usize,
    ) -> Option<FeeBatch<usize>> {
        build(amounts, min_vaults, max_vaults, |index, _| {
            Ok::<_, Infallible>(BuildStep::Ready {
                transaction: index + 1,
                tx_fee: fees[index],
            })
        })
        .unwrap()
    }

    #[test]
    fn takes_every_vault_regardless_of_transaction_fee() {
        let batch = build_with(&[500, 400, 150], &[600, 700, 800], 1, 10);

        assert_eq!(
            batch,
            Some(FeeBatch {
                count: 3,
                total_amount: 1_050,
                tx_fee: 800,
                transaction: 3,
            })
        );
    }

    #[test]
    fn stops_at_max_vaults() {
        let batch = build_with(&[500, 400, 150], &[200, 300, 400], 1, 2);

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
    fn rejects_a_batch_below_the_minimum_vault_count() {
        let batch = build_with(&[500, 400, 150, 100], &[200, 300, 400, 500], 5, 10);

        assert_eq!(batch, None);
    }

    #[test]
    fn empty_input_selects_nothing() {
        let batch = build_with(&[], &[], 5, 10);

        assert_eq!(batch, None);
    }

    #[test]
    fn zero_cap_selects_nothing() {
        let batch = build_with(&[2_000], &[100], 1, 0);

        assert_eq!(batch, None);
    }

    #[test]
    fn skips_a_vault_without_a_keeper_and_continues() {
        let batch = build(&[500, 400, 150], 1, 10, |index, _| {
            Ok::<_, Infallible>(match index {
                0 => BuildStep::Ready {
                    transaction: 1,
                    tx_fee: 200,
                },
                1 => BuildStep::Skip,
                2 => BuildStep::Ready {
                    transaction: 3,
                    tx_fee: 280,
                },
                _ => panic!("selection reached vault {index}"),
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
        let batch = build(&[500, 400, 300, 200], 1, 2, |index, _| {
            Ok::<_, Infallible>(match index {
                0 => BuildStep::Skip,
                1 => BuildStep::Ready {
                    transaction: 2,
                    tx_fee: 100,
                },
                2 => BuildStep::Ready {
                    transaction: 3,
                    tx_fee: 180,
                },
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
    fn an_undersized_prefix_does_not_hide_a_failure() {
        let error = build(&[500, 400], 2, 10, |index, _| match index {
            0 => Ok(BuildStep::Ready {
                transaction: 1,
                tx_fee: 200,
            }),
            1 => Ok(BuildStep::Stop("fee")),
            _ => panic!("selection continued after stop"),
        })
        .unwrap_err();

        assert_eq!(error, "fee");
    }

    #[test]
    fn stop_after_a_ready_vault_returns_that_prefix() {
        let batch = build(&[500, 400, 150], 1, 10, |index, _| match index {
            0 => Ok(BuildStep::Ready {
                transaction: 1,
                tx_fee: 900,
            }),
            1 => Ok(BuildStep::Stop("fee")),
            _ => panic!("selection continued after stop"),
        })
        .unwrap();

        assert_eq!(
            batch,
            Some(FeeBatch {
                count: 1,
                total_amount: 500,
                tx_fee: 900,
                transaction: 1,
            })
        );
    }

    #[test]
    fn stop_on_the_first_vault_returns_the_error() {
        let error = build::<usize, _>(&[500, 400], 1, 10, |index, _| {
            if index == 0 {
                Ok(BuildStep::Stop("fee"))
            } else {
                panic!("selection continued after stop")
            }
        })
        .unwrap_err();

        assert_eq!(error, "fee");
    }

    #[test]
    fn fail_after_a_ready_vault_cancels_the_batch() {
        let error = build(&[500, 400], 1, 10, |index, _| match index {
            0 => Ok(BuildStep::Ready {
                transaction: 1,
                tx_fee: 100,
            }),
            1 => Err("network"),
            _ => panic!("selection continued after fail"),
        })
        .unwrap_err();

        assert_eq!(error, "network");
    }
}
