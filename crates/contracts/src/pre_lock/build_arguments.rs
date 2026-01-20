use std::collections::HashMap;

use simplicityhl::num::U256;
use simplicityhl::{Arguments, str::WitnessName, value::UIntValue};

use crate::sdk::parameters::LendingParameters;

#[derive(Debug, Clone, bincode::Encode, bincode::Decode, PartialEq, Eq, Default)]
pub struct PreLockArguments {
    collateral_asset_id: [u8; 32],
    principal_asset_id: [u8; 32],
    borrower_nft_asset_id: [u8; 32],
    lender_nft_asset_id: [u8; 32],
    first_parameters_nft_asset_id: [u8; 32],
    second_parameters_nft_asset_id: [u8; 32],
    lending_cov_hash: [u8; 32],
    parameters_nft_output_script_hash: [u8; 32],
    borrower_nft_output_script_hash: [u8; 32],
    principal_output_script_hash: [u8; 32],
    borrower_pub_key: [u8; 32],
    collateral_amount: u64,
    principal_amount: u64,
    loan_expiration_time: u32,
    principal_interest_rate: u16,
}

impl PreLockArguments {
    /// Create new `PreLockArguments`
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        collateral_asset_id: [u8; 32],
        principal_asset_id: [u8; 32],
        borrower_nft_asset_id: [u8; 32],
        lender_nft_asset_id: [u8; 32],
        first_parameters_nft_asset_id: [u8; 32],
        second_parameters_nft_asset_id: [u8; 32],
        lending_cov_hash: [u8; 32],
        parameters_nft_output_script_hash: [u8; 32],
        borrower_nft_output_script_hash: [u8; 32],
        principal_output_script_hash: [u8; 32],
        borrower_pub_key: [u8; 32],
        lending_params: &LendingParameters,
    ) -> Self {
        Self {
            collateral_asset_id,
            principal_asset_id,
            borrower_nft_asset_id,
            lender_nft_asset_id,
            first_parameters_nft_asset_id,
            second_parameters_nft_asset_id,
            lending_cov_hash,
            parameters_nft_output_script_hash,
            borrower_nft_output_script_hash,
            principal_output_script_hash,
            borrower_pub_key,
            collateral_amount: lending_params.collateral_amount,
            principal_amount: lending_params.principal_amount,
            loan_expiration_time: lending_params.loan_expiration_time,
            principal_interest_rate: lending_params.principal_interest_rate,
        }
    }

    /// Returns the collateral asset id
    #[must_use]
    pub const fn collateral_asset_id(&self) -> [u8; 32] {
        self.collateral_asset_id
    }

    /// Returns the principal asset id
    #[must_use]
    pub const fn principal_asset_id(&self) -> [u8; 32] {
        self.principal_asset_id
    }

    /// Returns the borrower NFT asset id
    #[must_use]
    pub const fn borrower_nft_asset_id(&self) -> [u8; 32] {
        self.borrower_nft_asset_id
    }

    /// Returns the lender NFT asset id
    #[must_use]
    pub const fn lender_nft_asset_id(&self) -> [u8; 32] {
        self.lender_nft_asset_id
    }

    /// Returns the first parameters NFT asset id
    #[must_use]
    pub const fn first_parameters_nft_asset_id(&self) -> [u8; 32] {
        self.first_parameters_nft_asset_id
    }

    /// Returns the second parameters NFT asset id
    #[must_use]
    pub const fn second_parameters_nft_asset_id(&self) -> [u8; 32] {
        self.second_parameters_nft_asset_id
    }

    /// Returns the lending covenant script hash
    #[must_use]
    pub const fn lending_cov_hash(&self) -> [u8; 32] {
        self.lending_cov_hash
    }

    /// Returns the parameters NFT output script hash
    #[must_use]
    pub const fn parameters_nft_output_script_hash(&self) -> [u8; 32] {
        self.parameters_nft_output_script_hash
    }

    /// Returns the borrower NFT output script hash
    #[must_use]
    pub const fn borrower_nft_output_script_hash(&self) -> [u8; 32] {
        self.borrower_nft_output_script_hash
    }

    /// Returns the principal UTXO output script hash
    #[must_use]
    pub const fn principal_output_script_hash(&self) -> [u8; 32] {
        self.principal_output_script_hash
    }

    /// Returns the borrower public key
    #[must_use]
    pub const fn borrower_pub_key(&self) -> [u8; 32] {
        self.borrower_pub_key
    }

    /// Returns the `LendingParameters` struct with the lending offer parameters
    #[must_use]
    pub const fn lending_params(&self) -> LendingParameters {
        LendingParameters {
            collateral_amount: self.collateral_amount,
            principal_amount: self.principal_amount,
            principal_interest_rate: self.principal_interest_rate,
            loan_expiration_time: self.loan_expiration_time,
        }
    }

    /// Convert to Simplicity program arguments.
    #[must_use]
    pub fn build_pre_lock_arguments(&self) -> Arguments {
        Arguments::from(HashMap::from([
            (
                WitnessName::from_str_unchecked("COLLATERAL_ASSET_ID"),
                simplicityhl::Value::from(UIntValue::U256(U256::from_byte_array(
                    self.collateral_asset_id,
                ))),
            ),
            (
                WitnessName::from_str_unchecked("PRINCIPAL_ASSET_ID"),
                simplicityhl::Value::from(UIntValue::U256(U256::from_byte_array(
                    self.principal_asset_id,
                ))),
            ),
            (
                WitnessName::from_str_unchecked("BORROWER_NFT_ASSET_ID"),
                simplicityhl::Value::from(UIntValue::U256(U256::from_byte_array(
                    self.borrower_nft_asset_id,
                ))),
            ),
            (
                WitnessName::from_str_unchecked("LENDER_NFT_ASSET_ID"),
                simplicityhl::Value::from(UIntValue::U256(U256::from_byte_array(
                    self.lender_nft_asset_id,
                ))),
            ),
            (
                WitnessName::from_str_unchecked("FIRST_PARAMETERS_NFT_ASSET_ID"),
                simplicityhl::Value::from(UIntValue::U256(U256::from_byte_array(
                    self.first_parameters_nft_asset_id,
                ))),
            ),
            (
                WitnessName::from_str_unchecked("SECOND_PARAMETERS_NFT_ASSET_ID"),
                simplicityhl::Value::from(UIntValue::U256(U256::from_byte_array(
                    self.second_parameters_nft_asset_id,
                ))),
            ),
            (
                WitnessName::from_str_unchecked("LENDING_COV_HASH"),
                simplicityhl::Value::from(UIntValue::U256(U256::from_byte_array(
                    self.lending_cov_hash,
                ))),
            ),
            (
                WitnessName::from_str_unchecked("PARAMETERS_NFT_OUTPUT_SCRIPT_HASH"),
                simplicityhl::Value::from(UIntValue::U256(U256::from_byte_array(
                    self.parameters_nft_output_script_hash,
                ))),
            ),
            (
                WitnessName::from_str_unchecked("BORROWER_NFT_OUTPUT_SCRIPT_HASH"),
                simplicityhl::Value::from(UIntValue::U256(U256::from_byte_array(
                    self.borrower_nft_output_script_hash,
                ))),
            ),
            (
                WitnessName::from_str_unchecked("PRINCIPAL_OUTPUT_SCRIPT_HASH"),
                simplicityhl::Value::from(UIntValue::U256(U256::from_byte_array(
                    self.principal_output_script_hash,
                ))),
            ),
            (
                WitnessName::from_str_unchecked("BORROWER_PUB_KEY"),
                simplicityhl::Value::from(UIntValue::U256(U256::from_byte_array(
                    self.borrower_pub_key,
                ))),
            ),
            (
                WitnessName::from_str_unchecked("COLLATERAL_AMOUNT"),
                simplicityhl::Value::from(UIntValue::U64(self.collateral_amount)),
            ),
            (
                WitnessName::from_str_unchecked("PRINCIPAL_AMOUNT"),
                simplicityhl::Value::from(UIntValue::U64(self.principal_amount)),
            ),
            (
                WitnessName::from_str_unchecked("LOAN_EXPIRATION_TIME"),
                simplicityhl::Value::from(UIntValue::U32(self.loan_expiration_time)),
            ),
            (
                WitnessName::from_str_unchecked("PRINCIPAL_INTEREST_RATE"),
                simplicityhl::Value::from(UIntValue::U16(self.principal_interest_rate)),
            ),
        ]))
    }
}

impl simplicityhl_core::Encodable for PreLockArguments {}
