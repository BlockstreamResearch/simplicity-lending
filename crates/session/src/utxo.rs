use simplex::simplicityhl::elements::AssetId;
use simplex::transaction::UTXO;

#[derive(Debug, Clone)]
pub struct SelectedUtxos {
    asset_id: AssetId,
    utxos: Vec<UTXO>,
    total_amount: u64,
    needed_amount: u64,
}

impl SelectedUtxos {
    pub fn asset_id(&self) -> AssetId {
        self.asset_id
    }

    pub fn utxos(&self) -> &[UTXO] {
        &self.utxos
    }

    pub fn into_utxos(self) -> Vec<UTXO> {
        self.utxos
    }

    pub fn total_amount(&self) -> u64 {
        self.total_amount
    }

    pub fn needed_amount(&self) -> u64 {
        self.needed_amount
    }

    pub fn change_amount(&self) -> u64 {
        self.total_amount - self.needed_amount
    }

    pub fn has_change(&self) -> bool {
        self.change_amount() > 0
    }

    pub fn any_confidential(&self) -> bool {
        self.utxos.iter().any(|utxo| utxo.secrets.is_some())
    }
}

pub fn select_utxos_for_amount(
    utxos: impl IntoIterator<Item = UTXO>,
    asset_id: AssetId,
    needed_amount: u64,
) -> Option<SelectedUtxos> {
    if needed_amount == 0 {
        return Some(SelectedUtxos {
            asset_id,
            utxos: Vec::new(),
            total_amount: 0,
            needed_amount: 0,
        });
    }

    let mut selected = Vec::new();
    let mut total_amount = 0u64;

    for utxo in utxos {
        if utxo.asset() != asset_id {
            continue;
        }

        total_amount = total_amount.saturating_add(utxo.amount());
        selected.push(utxo);

        if total_amount >= needed_amount {
            return Some(SelectedUtxos {
                asset_id,
                utxos: selected,
                total_amount,
                needed_amount,
            });
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use simplex::simplicityhl::elements::confidential::{AssetBlindingFactor, ValueBlindingFactor};
    use simplex::simplicityhl::elements::hashes::Hash;
    use simplex::simplicityhl::elements::{AssetId, OutPoint, TxOut, TxOutSecrets, Txid};
    use simplex::transaction::UTXO;

    use super::{SelectedUtxos, select_utxos_for_amount};

    fn asset() -> AssetId {
        AssetId::from_slice(&[0xAAu8; 32]).unwrap()
    }

    fn other_asset() -> AssetId {
        AssetId::from_slice(&[0xBBu8; 32]).unwrap()
    }

    fn txid(byte: u8) -> Txid {
        Txid::from_slice(&[byte; 32]).unwrap()
    }

    fn explicit_utxo(vout: u32, amount: u64, asset_id: AssetId) -> UTXO {
        UTXO {
            outpoint: OutPoint::new(txid(vout as u8), vout),
            txout: TxOut::new_fee(amount, asset_id),
            secrets: None,
        }
    }

    fn confidential_utxo(vout: u32, amount: u64, asset_id: AssetId) -> UTXO {
        UTXO {
            outpoint: OutPoint::new(txid(0x80 | vout as u8), vout),
            txout: TxOut::default(),
            secrets: Some(TxOutSecrets::new(
                asset_id,
                AssetBlindingFactor::zero(),
                amount,
                ValueBlindingFactor::zero(),
            )),
        }
    }

    #[test]
    fn selects_single_sufficient_utxo() {
        let selected = select_utxos_for_amount(
            [
                explicit_utxo(0, 15_000, asset()),
                explicit_utxo(1, 5_000, asset()),
            ],
            asset(),
            10_000,
        )
        .expect("enough funds");

        assert_eq!(selected.asset_id(), asset());
        assert_eq!(selected.utxos().len(), 1);
        assert_eq!(selected.total_amount(), 15_000);
        assert_eq!(selected.change_amount(), 5_000);
        assert!(selected.has_change());
        assert!(!selected.any_confidential());
    }

    #[test]
    fn accumulates_multiple_utxos_until_amount_is_met() {
        let selected = select_utxos_for_amount(
            [
                explicit_utxo(0, 6_000, asset()),
                explicit_utxo(1, 5_000, asset()),
            ],
            asset(),
            10_000,
        )
        .expect("enough when combined");

        assert_eq!(selected.utxos().len(), 2);
        assert_eq!(selected.total_amount(), 11_000);
        assert_eq!(selected.change_amount(), 1_000);
    }

    #[test]
    fn skips_utxos_of_other_assets() {
        let selected = select_utxos_for_amount(
            [
                explicit_utxo(0, 20_000, other_asset()),
                explicit_utxo(1, 6_000, asset()),
                explicit_utxo(2, 5_000, asset()),
            ],
            asset(),
            10_000,
        )
        .expect("should ignore foreign asset");

        assert_eq!(selected.utxos().len(), 2);
        assert_eq!(selected.total_amount(), 11_000);
        assert!(selected.utxos().iter().all(|utxo| utxo.asset() == asset()));
    }

    #[test]
    fn returns_none_when_combined_amount_is_insufficient() {
        assert!(
            select_utxos_for_amount(
                [
                    explicit_utxo(0, 4_000, asset()),
                    explicit_utxo(1, 5_000, asset()),
                ],
                asset(),
                10_000,
            )
            .is_none()
        );
    }

    #[test]
    fn supports_confidential_amounts_via_amount() {
        let selected = select_utxos_for_amount(
            [
                confidential_utxo(0, 4_000, asset()),
                confidential_utxo(1, 7_000, asset()),
            ],
            asset(),
            10_000,
        )
        .expect("confidential amounts should count");

        assert_eq!(selected.utxos().len(), 2);
        assert_eq!(selected.total_amount(), 11_000);
        assert!(selected.any_confidential());
    }

    #[test]
    fn mixes_explicit_and_confidential_utxos() {
        let selected = select_utxos_for_amount(
            [
                explicit_utxo(0, 3_000, asset()),
                confidential_utxo(1, 8_000, asset()),
            ],
            asset(),
            10_000,
        )
        .expect("mixed selection");

        assert_eq!(selected.utxos().len(), 2);
        assert!(selected.any_confidential());
    }

    #[test]
    fn zero_needed_returns_empty_selection() {
        let selected = select_utxos_for_amount([explicit_utxo(0, 1_000, asset())], asset(), 0)
            .expect("zero needed");

        assert_eq!(selected.asset_id(), asset());
        assert!(selected.utxos().is_empty());
        assert_eq!(selected.total_amount(), 0);
        assert!(!selected.has_change());
    }

    #[test]
    fn into_utxos_consumes_selection() {
        let selected: SelectedUtxos =
            select_utxos_for_amount([explicit_utxo(0, 10_000, asset())], asset(), 10_000).unwrap();
        let utxos = selected.into_utxos();
        assert_eq!(utxos.len(), 1);
        assert_eq!(utxos[0].amount(), 10_000);
    }
}
