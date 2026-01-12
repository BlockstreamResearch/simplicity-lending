use std::collections::HashMap;

use simplicityhl::num::U256;
use simplicityhl::{Arguments, str::WitnessName, value::UIntValue};

use crate::sdk::parameters::LendingParameters;

#[derive(Debug, Clone, bincode::Encode, bincode::Decode, PartialEq, Eq, Default)]
pub struct LendingArguments {
    collateral_asset_id: [u8; 32],
    principal_asset_id: [u8; 32],
    borrower_nft_asset_id: [u8; 32],
    lender_nft_asset_id: [u8; 32],
    first_parameters_nft_asset_id: [u8; 32],
    second_parameters_nft_asset_id: [u8; 32],
    lender_principal_cov_hash: [u8; 32],
    collateral_amount: u64,
    principal_amount: u64,
    loan_expiration_time: u32,
    principal_interest_rate: u16,
}

impl LendingArguments {
    #[must_use]
    pub fn new(
        collateral_asset_id: [u8; 32],
        principal_asset_id: [u8; 32],
        borrower_nft_asset_id: [u8; 32],
        lender_nft_asset_id: [u8; 32],
        first_parameters_nft_asset_id: [u8; 32],
        second_parameters_nft_asset_id: [u8; 32],
        lender_principal_cov_hash: [u8; 32],
        collateral_amount: u64,
        principal_amount: u64,
        loan_expiration_time: u32,
        principal_interest_rate: u16,
    ) -> Self {
        Self {
            collateral_asset_id,
            principal_asset_id,
            borrower_nft_asset_id,
            lender_nft_asset_id,
            first_parameters_nft_asset_id,
            second_parameters_nft_asset_id,
            lender_principal_cov_hash,
            collateral_amount,
            principal_amount,
            loan_expiration_time,
            principal_interest_rate,
        }
    }

    pub const fn collateral_asset_id(&self) -> [u8; 32] {
        self.collateral_asset_id
    }

    pub const fn principal_asset_id(&self) -> [u8; 32] {
        self.principal_asset_id
    }

    pub const fn borrower_nft_asset_id(&self) -> [u8; 32] {
        self.borrower_nft_asset_id
    }

    pub const fn lender_nft_asset_id(&self) -> [u8; 32] {
        self.lender_nft_asset_id
    }

    pub const fn first_parameters_nft_asset_id(&self) -> [u8; 32] {
        self.first_parameters_nft_asset_id
    }

    pub const fn second_parameters_nft_asset_id(&self) -> [u8; 32] {
        self.second_parameters_nft_asset_id
    }

    pub const fn lender_principal_cov_hash(&self) -> [u8; 32] {
        self.lender_principal_cov_hash
    }

    pub const fn lending_params(&self) -> LendingParameters {
        LendingParameters {
            collateral_amount: self.collateral_amount,
            principal_amount: self.principal_amount,
            principal_interest_rate: self.principal_interest_rate,
            loan_expiration_time: self.loan_expiration_time,
        }
    }

    #[must_use]
    pub fn build_lending_arguments(&self) -> Arguments {
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
                WitnessName::from_str_unchecked("LENDER_PRINCIPAL_COV_HASH"),
                simplicityhl::Value::from(UIntValue::U256(U256::from_byte_array(
                    self.lender_principal_cov_hash,
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

impl simplicityhl_core::Encodable for LendingArguments {}
