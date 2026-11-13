use simplex::simplicityhl::elements::AssetId;
use simplex::simplicityhl::elements::hashes::sha256;

use crate::artifacts::contracts::vault::lender_principal_vault::LenderPrincipalVaultProgram;
use crate::lender_principal_vault::LenderPrincipalVaultError;
use crate::utils::storage::set_storage_slots;

/// The vault state. The contract keeps only its hash in the single storage slot and takes the
/// fields from the witness.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LenderPrincipalVaultStorage {
    pub is_finalized: bool,
    pub supplied_amount: u64,
    pub supplied_fee: u64,
    pub withdrawn_amount: u64,
    pub withdrawn_protocol_fee: u64,
    pub lender_asset_id: AssetId,
    pub lending_offer_asset_id: AssetId,
}

impl LenderPrincipalVaultStorage {
    pub const SLOTS: usize = 1;

    /// The length of the hashed preimage: `is_finalized`, four amounts and two asset ids.
    const PREIMAGE_LEN: usize = 97;

    /// A vault nothing was supplied to yet.
    #[must_use]
    pub fn new(lender_asset_id: AssetId, lending_offer_asset_id: AssetId) -> Self {
        Self {
            is_finalized: false,
            supplied_amount: 0,
            supplied_fee: 0,
            withdrawn_amount: 0,
            withdrawn_protocol_fee: 0,
            lender_asset_id,
            lending_offer_asset_id,
        }
    }

    /// SHA256 of the fields concatenated in order: a bool is one byte (0 or 1), a u64 is
    /// 8 bytes big-endian and an asset id is 32 bytes.
    #[must_use]
    pub fn storage_hash(&self) -> [u8; 32] {
        let mut bytes = Vec::with_capacity(Self::PREIMAGE_LEN);

        bytes.push(u8::from(self.is_finalized));

        for amount in [
            self.supplied_amount,
            self.supplied_fee,
            self.withdrawn_amount,
            self.withdrawn_protocol_fee,
        ] {
            bytes.extend(amount.to_be_bytes());
        }

        bytes.extend(self.lender_asset_id.to_byte_array());
        bytes.extend(self.lending_offer_asset_id.to_byte_array());

        sha256::Hash::hash(&bytes).to_byte_array()
    }

    #[must_use]
    pub fn slots(&self) -> [[u8; 32]; Self::SLOTS] {
        [self.storage_hash()]
    }

    /// The state after supplying `amount_to_supply` with `fee_to_supply` of it being the fee.
    ///
    /// # Errors
    /// Returns [`LenderPrincipalVaultError::AccountingOverflow`] if a total exceeds u64.
    pub fn with_supply(
        &self,
        amount_to_supply: u64,
        fee_to_supply: u64,
        finalize: bool,
    ) -> Result<Self, LenderPrincipalVaultError> {
        Ok(Self {
            is_finalized: finalize,
            supplied_amount: checked_add(self.supplied_amount, amount_to_supply)?,
            supplied_fee: checked_add(self.supplied_fee, fee_to_supply)?,
            ..*self
        })
    }

    /// The state after the lender withdraws `amount_to_withdraw`.
    ///
    /// # Errors
    /// Returns [`LenderPrincipalVaultError::AccountingOverflow`] if the withdrawn total exceeds u64.
    pub fn with_lender_withdrawal(
        &self,
        amount_to_withdraw: u64,
        finalize: bool,
    ) -> Result<Self, LenderPrincipalVaultError> {
        Ok(Self {
            is_finalized: finalize,
            withdrawn_amount: checked_add(self.withdrawn_amount, amount_to_withdraw)?,
            ..*self
        })
    }

    /// The state after the protocol harvester withdraws `protocol_fee_to_withdraw`.
    ///
    /// # Errors
    /// Returns [`LenderPrincipalVaultError::AccountingOverflow`] if the withdrawn total exceeds u64.
    pub fn with_protocol_fee_withdrawal(
        &self,
        protocol_fee_to_withdraw: u64,
    ) -> Result<Self, LenderPrincipalVaultError> {
        Ok(Self {
            withdrawn_protocol_fee: checked_add(
                self.withdrawn_protocol_fee,
                protocol_fee_to_withdraw,
            )?,
            ..*self
        })
    }

    pub(crate) fn apply(&self, program: &mut LenderPrincipalVaultProgram) {
        set_storage_slots(program, &self.slots());
    }
}

fn checked_add(a: u64, b: u64) -> Result<u64, LenderPrincipalVaultError> {
    a.checked_add(b)
        .ok_or(LenderPrincipalVaultError::AccountingOverflow)
}
