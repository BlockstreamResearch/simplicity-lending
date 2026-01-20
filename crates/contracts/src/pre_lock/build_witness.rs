use std::collections::HashMap;

use simplicityhl::Value;
use simplicityhl::simplicity::bitcoin;
use simplicityhl::value::ValueConstructible;
use simplicityhl::{
    ResolvedType, WitnessValues, parse::ParseFromStr, str::WitnessName, types::TypeConstructible,
};

#[derive(Debug, Clone, Copy)]
pub enum PreLockBranch<'a> {
    // Left(())
    LendingCreation,
    // Right(Signature)
    PreLockCancellation {
        cancellation_signature: &'a bitcoin::secp256k1::schnorr::Signature,
    },
}

/// Build witness values for pre lock program execution.
///
/// # Panics
/// Panics if type parsing fails (should never happen with valid constants).
#[must_use]
pub fn build_pre_lock_witness(branch: PreLockBranch) -> WitnessValues {
    let lending_creation = ResolvedType::parse_from_str("()").unwrap();
    let pre_lock_cancellation = ResolvedType::parse_from_str("Signature").unwrap();

    let path_type = ResolvedType::either(lending_creation, pre_lock_cancellation);

    let branch_str = match branch {
        PreLockBranch::LendingCreation => "Left(())".to_string(),
        PreLockBranch::PreLockCancellation {
            cancellation_signature,
        } => {
            format!(
                "Right({})",
                Value::byte_array(cancellation_signature.serialize()),
            )
        }
    };

    simplicityhl::WitnessValues::from(HashMap::from([(
        WitnessName::from_str_unchecked("PATH"),
        simplicityhl::Value::parse_from_str(&branch_str, &path_type).unwrap(),
    )]))
}
