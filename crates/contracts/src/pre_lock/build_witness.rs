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
    // Right(())
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
    let pre_lock_cancellation = ResolvedType::parse_from_str("()").unwrap();

    let path_type = ResolvedType::either(lending_creation, pre_lock_cancellation);

    let path = match branch {
        PreLockBranch::LendingCreation => "Left(())".to_string(),
        PreLockBranch::PreLockCancellation { .. } => "Right(())".to_string(),
    };

    let mut values = HashMap::from([(
        WitnessName::from_str_unchecked("PATH"),
        simplicityhl::Value::parse_from_str(&path, &path_type).unwrap(),
    )]);

    if let PreLockBranch::PreLockCancellation {
        cancellation_signature,
    } = branch
    {
        values.insert(
            WitnessName::from_str_unchecked("CANCELLATION_SIGNATURE"),
            Value::byte_array(cancellation_signature.serialize()),
        );
    } else {
        values.insert(
            WitnessName::from_str_unchecked("CANCELLATION_SIGNATURE"),
            Value::byte_array([0; 64]),
        );
    }

    simplicityhl::WitnessValues::from(values)
}
