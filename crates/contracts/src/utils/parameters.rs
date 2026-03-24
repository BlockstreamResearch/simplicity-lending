#![allow(clippy::double_must_use)]
#![allow(clippy::must_use_candidate)]

use std::num::TryFromIntError;

use modular_bitfield::{error::OutOfBounds, prelude::*};

#[derive(Debug, thiserror::Error)]
pub enum ParametersError {
    #[error("Invalid collateral amount: expected {expected}, got {actual}")]
    InvalidCollateralAmount { expected: String, actual: String },

    #[error("Invalid principal amount: expected {expected}, got {actual}")]
    InvalidPrincipalAmount { expected: String, actual: String },

    #[error("Invalid interest rate: expected {expected}, got {actual}")]
    InvalidInterestRate { expected: String, actual: String },

    #[error("Invalid loan expiration time: expected {expected}, got {actual}")]
    InvalidLoanExpirationTime { expected: String, actual: String },

    #[error("Out of bounds error: {actual_error}")]
    ValueOutOfBounds { actual_error: String },
}

#[derive(Debug, Clone, Copy)]
pub struct LendingOfferParameters {
    pub collateral_amount: u64,
    pub principal_amount: u64,
    pub loan_expiration_time: u32,
    pub principal_interest_rate: u16,
}

impl LendingOfferParameters {
    /// Build lending parameters by using values from the first and second NFT parameters
    #[must_use]
    pub fn build_from_parameters_nfts(
        first_nft_params: &FirstNFTParameters,
        second_nft_params: &SecondNFTParameters,
    ) -> Self {
        let collateral_amount = from_base_amount(
            second_nft_params.collateral_base_amount(),
            first_nft_params.collateral_dec(),
        );
        let principal_amount = from_base_amount(
            second_nft_params.principal_base_amount(),
            first_nft_params.principal_dec(),
        );

        Self {
            collateral_amount,
            principal_amount,
            loan_expiration_time: first_nft_params.loan_expiration_time(),
            principal_interest_rate: first_nft_params.interest_rate(),
        }
    }

    /// Encode Parameters NFT amounts from the `LendingOfferParameters` values and the passed `amounts_decimals`
    ///
    /// # Errors
    /// Returns an error if a parameter from `LendingOfferParameters` is out of bounds of the parameters bits structure
    pub fn encode_parameters_nft_amounts(
        &self,
        amounts_decimals: u8,
    ) -> Result<(u64, u64), ParametersError> {
        let first_parameters_nft_encoded_amount = FirstNFTParameters::encode(
            self.principal_interest_rate,
            self.loan_expiration_time,
            amounts_decimals,
            amounts_decimals,
        )
        .map_err(|e| ParametersError::ValueOutOfBounds {
            actual_error: e.to_string(),
        })?;
        let second_parameters_nft_encoded_amount = SecondNFTParameters::encode(
            to_base_amount(self.collateral_amount, amounts_decimals),
            to_base_amount(self.principal_amount, amounts_decimals),
        )
        .map_err(|e| ParametersError::ValueOutOfBounds {
            actual_error: e.to_string(),
        })?;

        Ok((
            first_parameters_nft_encoded_amount,
            second_parameters_nft_encoded_amount,
        ))
    }

    /// Validate lending offer parameters according to the first and second NFT parameters
    ///
    /// # Errors
    /// Returns an error if a parameter from `LendingOfferParameters` differs from the NFT parameter
    pub fn validate_params(
        &self,
        first_nft_params: &FirstNFTParameters,
        second_nft_params: &SecondNFTParameters,
    ) -> Result<(), ParametersError> {
        let collateral_amount = from_base_amount(
            second_nft_params.collateral_base_amount(),
            first_nft_params.collateral_dec(),
        );
        let principal_amount = from_base_amount(
            second_nft_params.principal_base_amount(),
            first_nft_params.principal_dec(),
        );

        if self.collateral_amount != collateral_amount {
            return Err(ParametersError::InvalidCollateralAmount {
                expected: collateral_amount.to_string(),
                actual: self.collateral_amount.to_string(),
            });
        }

        if self.principal_amount != principal_amount {
            return Err(ParametersError::InvalidPrincipalAmount {
                expected: principal_amount.to_string(),
                actual: self.principal_amount.to_string(),
            });
        }

        if self.principal_interest_rate != first_nft_params.interest_rate() {
            return Err(ParametersError::InvalidInterestRate {
                expected: first_nft_params.interest_rate().to_string(),
                actual: self.principal_interest_rate.to_string(),
            });
        }

        if self.loan_expiration_time != first_nft_params.loan_expiration_time() {
            return Err(ParametersError::InvalidLoanExpirationTime {
                expected: first_nft_params.loan_expiration_time().to_string(),
                actual: self.loan_expiration_time.to_string(),
            });
        }

        Ok(())
    }
}

#[bitfield]
#[must_use]
pub struct FirstNFTParameters {
    pub interest_rate: B16,
    pub loan_expiration_time: B27,
    pub collateral_dec: B4,
    pub principal_dec: B4,
    #[skip]
    unused: B13,
}

impl FirstNFTParameters {
    /// Encode base amounts in the u64 amount
    ///
    /// # Errors
    /// Returns an error if passed parameters exceed the next bit structure:
    ///  - `interest_rate` - 16 bits
    ///  - `loan_expiration_time` - 27 bits
    ///  - `collateral_dec` - 4 bits
    ///  - `principal_dec` - 4 bits
    pub fn encode(
        interest_rate: u16,
        loan_expiration_time: u32,
        collateral_dec: u8,
        principal_dec: u8,
    ) -> Result<u64, OutOfBounds> {
        let params = FirstNFTParameters::new()
            .with_interest_rate(interest_rate)
            .with_loan_expiration_time_checked(loan_expiration_time)?
            .with_collateral_dec_checked(collateral_dec)?
            .with_principal_dec_checked(principal_dec)?;

        Ok(u64::from_le_bytes(params.into_bytes()))
    }

    #[must_use]
    pub fn decode(encoded_amount: u64) -> Self {
        Self::from_bytes(encoded_amount.to_le_bytes())
    }
}

#[bitfield]
#[must_use]
pub struct SecondNFTParameters {
    pub collateral_base_amount: B25,
    pub principal_base_amount: B25,
    #[skip]
    unused: B14,
}

impl SecondNFTParameters {
    /// Encode base amounts in the u64 amount
    ///
    /// # Errors
    /// Returns an error if passed base amounts exceed the 25-bit value limit
    pub fn encode(
        collateral_base_amount: u32,
        principal_base_amount: u32,
    ) -> Result<u64, OutOfBounds> {
        let params = SecondNFTParameters::new()
            .with_collateral_base_amount_checked(collateral_base_amount)?
            .with_principal_base_amount_checked(principal_base_amount)?;

        Ok(u64::from_le_bytes(params.into_bytes()))
    }

    #[must_use]
    pub fn decode(encoded_amount: u64) -> Self {
        Self::from_bytes(encoded_amount.to_le_bytes())
    }
}

pub const MAX_LIQUID_AMOUNT: u64 = 2_100_000_000_000_000;
pub const MAX_BASIS_POINTS: u64 = 10_000;

const POWERS_OF_10: [u64; 16] = [
    1,                     // 10^0
    10,                    // 10^1
    100,                   // 10^2
    1_000,                 // 10^3
    10_000,                // 10^4
    100_000,               // 10^5
    1_000_000,             // 10^6
    10_000_000,            // 10^7
    100_000_000,           // 10^8
    1_000_000_000,         // 10^9
    10_000_000_000,        // 10^10
    100_000_000_000,       // 10^11
    1_000_000_000_000,     // 10^12
    10_000_000_000_000,    // 10^13
    100_000_000_000_000,   // 10^14
    1_000_000_000_000_000, // 10^15
];

/// Convert amount from base amount using the passed decimal mantissa
///
/// # Panics
/// - if `decimals_mantissa` value is greater than 15
/// - if the result amount overflowed u64
/// - if the amount exceeds Liquid 51-bit limit
#[must_use]
pub fn from_base_amount(base_amount: u32, decimals_mantissa: u8) -> u64 {
    let multiplier = POWERS_OF_10
        .get(decimals_mantissa as usize)
        .expect("Decimals mantissa must be between 0 and 15");

    let result = u64::from(base_amount)
        .checked_mul(*multiplier)
        .expect("Amount overflowed u64");

    assert!(
        result <= MAX_LIQUID_AMOUNT,
        "Resulting amount {result} exceeds Liquid 51-bit limit",
    );

    result
}

/// Convert amount to base amount using the passed decimal mantissa
///
/// # Panics
/// - if `decimals_mantissa` value is greater than 15
/// - if the result base amount is greater than `U64::MAX`
#[must_use]
pub fn to_base_amount(amount: u64, decimals_mantissa: u8) -> u32 {
    let multiplier = POWERS_OF_10
        .get(decimals_mantissa as usize)
        .expect("Decimals mantissa must be between 0 and 15");

    let result: u32 = amount
        .checked_div(*multiplier)
        .unwrap()
        .try_into()
        .expect("Base amount greater than u32");

    result
}

/// Calculate interest amount based on the principal amount and the interest rate
///
/// # Errors
/// Returns an error if the result interest amount is greater than `U64::MAX`
pub fn calculate_interest(
    principal_amount: u64,
    interest_rate: u16,
) -> Result<u64, TryFromIntError> {
    let interest_wide = u128::from(principal_amount) * u128::from(interest_rate);
    let interest = interest_wide / u128::from(MAX_BASIS_POINTS);

    u64::try_from(interest)
}

/// Calculate principal amount with the principal interest
///
/// # Panics
/// - if final amount is greater than `U64::MAX`
#[must_use]
pub fn calculate_principal_with_interest(principal_amount: u64, interest_rate: u16) -> u64 {
    let interest = calculate_interest(principal_amount, interest_rate)
        .expect("Interest is greater than U64::MAX");

    principal_amount
        .checked_add(interest)
        .expect("Overflow in principal with interest calculation")
}
