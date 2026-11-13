use simplex::fuzz::proptest::prelude::{Strategy, any};
use simplex::simplicityhl::elements::AssetId;

use lending_contracts_v2::lender_principal_vault::LenderPrincipalVaultStorage;

use crate::support::fuzz;

/// `VaultStorage` as the test programs take it.
pub type StorageTuple = (bool, u64, u64, u64, u64, [u8; 32], [u8; 32]);

pub fn tuple(storage: &LenderPrincipalVaultStorage) -> StorageTuple {
    (
        storage.is_finalized,
        storage.supplied_amount,
        storage.supplied_fee,
        storage.withdrawn_amount,
        storage.withdrawn_protocol_fee,
        storage.lender_asset_id.to_byte_array(),
        storage.lending_offer_asset_id.to_byte_array(),
    )
}

pub fn from_tuple(storage: StorageTuple) -> LenderPrincipalVaultStorage {
    let (finalized, supplied_amount, supplied_fee, withdrawn_amount, withdrawn_fee, lender, offer) =
        storage;

    LenderPrincipalVaultStorage {
        is_finalized: finalized,
        supplied_amount,
        supplied_fee,
        withdrawn_amount,
        withdrawn_protocol_fee: withdrawn_fee,
        lender_asset_id: asset(lender),
        lending_offer_asset_id: asset(offer),
    }
}

fn asset(bytes: [u8; 32]) -> AssetId {
    AssetId::from_byte_array(bytes)
}

/// A storage whose fields all differ, so a field read from another position shows.
pub fn distinct() -> LenderPrincipalVaultStorage {
    LenderPrincipalVaultStorage {
        is_finalized: true,
        supplied_amount: 0x0102_0304_0506_0708,
        supplied_fee: 0x1112_1314_1516_1718,
        withdrawn_amount: 0x2122_2324_2526_2728,
        withdrawn_protocol_fee: 0x3132_3334_3536_3738,
        lender_asset_id: asset([0x41; 32]),
        lending_offer_asset_id: asset([0x51; 32]),
    }
}

/// A storage at the top of every field.
pub fn saturated() -> LenderPrincipalVaultStorage {
    LenderPrincipalVaultStorage {
        is_finalized: true,
        supplied_amount: u64::MAX,
        supplied_fee: u64::MAX,
        withdrawn_amount: u64::MAX,
        withdrawn_protocol_fee: u64::MAX,
        lender_asset_id: asset([0xff; 32]),
        lending_offer_asset_id: asset([0xff; 32]),
    }
}

pub fn fresh() -> LenderPrincipalVaultStorage {
    LenderPrincipalVaultStorage::new(asset([0x41; 32]), asset([0x51; 32]))
}

/// `storage` with one field changed, for each field.
pub fn each_field_changed(storage: &LenderPrincipalVaultStorage) -> [StorageTuple; 7] {
    let (finalized, supplied_amount, supplied_fee, withdrawn_amount, withdrawn_fee, lender, offer) =
        tuple(storage);
    let flip = |mut bytes: [u8; 32]| {
        bytes[31] ^= 1;
        bytes
    };

    [
        (
            !finalized,
            supplied_amount,
            supplied_fee,
            withdrawn_amount,
            withdrawn_fee,
            lender,
            offer,
        ),
        (
            finalized,
            supplied_amount ^ 1,
            supplied_fee,
            withdrawn_amount,
            withdrawn_fee,
            lender,
            offer,
        ),
        (
            finalized,
            supplied_amount,
            supplied_fee ^ 1,
            withdrawn_amount,
            withdrawn_fee,
            lender,
            offer,
        ),
        (
            finalized,
            supplied_amount,
            supplied_fee,
            withdrawn_amount ^ 1,
            withdrawn_fee,
            lender,
            offer,
        ),
        (
            finalized,
            supplied_amount,
            supplied_fee,
            withdrawn_amount,
            withdrawn_fee ^ 1,
            lender,
            offer,
        ),
        (
            finalized,
            supplied_amount,
            supplied_fee,
            withdrawn_amount,
            withdrawn_fee,
            flip(lender),
            offer,
        ),
        (
            finalized,
            supplied_amount,
            supplied_fee,
            withdrawn_amount,
            withdrawn_fee,
            lender,
            flip(offer),
        ),
    ]
}

/// A storage with every amount near the edges, for fuzz cases.
pub fn storages() -> impl Strategy<Value = StorageTuple> {
    (
        any::<bool>(),
        fuzz::amounts(),
        fuzz::amounts(),
        fuzz::amounts(),
        fuzz::amounts(),
        any::<[u8; 32]>(),
        any::<[u8; 32]>(),
    )
}
