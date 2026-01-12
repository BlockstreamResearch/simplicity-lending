use modular_bitfield::{error::OutOfBounds, prelude::*};

use crate::error::ParametersError;

#[derive(Debug, Clone)]
pub struct LendingParameters {
    pub collateral_amount: u64,
    pub principal_amount: u64,
    pub loan_expiration_time: u32,
    pub principal_interest_rate: u16,
}

impl LendingParameters {
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
pub struct FirstNFTParameters {
    pub interest_rate: B16,
    pub loan_expiration_time: B27,
    pub collateral_dec: B4,
    pub principal_dec: B4,
    #[skip]
    unused: B13,
}

impl FirstNFTParameters {
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

    pub fn decode(encoded_amount: u64) -> Self {
        Self::from_bytes(encoded_amount.to_le_bytes())
    }
}

#[bitfield]
pub struct SecondNFTParameters {
    pub collateral_base_amount: B25,
    pub principal_base_amount: B25,
    #[skip]
    unused: B14,
}

impl SecondNFTParameters {
    pub fn encode(
        collateral_base_amount: u32,
        principal_base_amount: u32,
    ) -> Result<u64, OutOfBounds> {
        let params = SecondNFTParameters::new()
            .with_collateral_base_amount_checked(collateral_base_amount)?
            .with_principal_base_amount_checked(principal_base_amount)?;

        Ok(u64::from_le_bytes(params.into_bytes()))
    }

    pub fn decode(encoded_amount: u64) -> Self {
        Self::from_bytes(encoded_amount.to_le_bytes())
    }
}

pub const MAX_LIQUID_AMOUNT: u64 = 2_100_000_000_000_000;

const POWERS_OF_10: [u64; 16] = [
    1,                // 10^0
    10,               // 10^1
    100,              // 10^2
    1000,             // 10^3
    10000,            // 10^4
    100000,           // 10^5
    1000000,          // 10^6
    10000000,         // 10^7
    100000000,        // 10^8
    1000000000,       // 10^9
    10000000000,      // 10^10
    100000000000,     // 10^11
    1000000000000,    // 10^12
    10000000000000,   // 10^13
    100000000000000,  // 10^14
    1000000000000000, // 10^15
];

pub fn from_base_amount(base_amount: u32, decimals_mantissa: u8) -> u64 {
    let multiplier = POWERS_OF_10
        .get(decimals_mantissa as usize)
        .expect("Decimals mantissa must be between 0 and 15");

    let result = (base_amount as u64)
        .checked_mul(*multiplier)
        .expect("Amount overflowed u64");

    assert!(
        result <= MAX_LIQUID_AMOUNT,
        "Resulting amount {result} exceeds Liquid 51-bit limit",
    );

    result
}

pub fn to_base_amount(amount: u64, decimals_mantissa: u8) -> u32 {
    let multiplier = POWERS_OF_10
        .get(decimals_mantissa as usize)
        .expect("Decimals mantissa must be between 0 and 15");

    let result: u32 = amount
        .checked_div(*multiplier)
        .unwrap()
        .try_into()
        .expect("Base amount bigger than the u32");

    result
}
