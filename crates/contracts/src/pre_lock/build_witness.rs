use std::collections::HashMap;

use simplicityhl::simplicity::bitcoin;
use simplicityhl::{
    ResolvedType, WitnessValues, parse::ParseFromStr, str::WitnessName, types::TypeConstructible,
};

#[derive(Debug, Clone, Copy)]
pub enum PreLockBranch<'a> {
    LendingCreation,
    PreLockCancellation {
        cancellation_signature: &'a bitcoin::secp256k1::schnorr::Signature,
    },
}

pub fn build_pre_lock_witness(branch: PreLockBranch) -> WitnessValues {
    let lending_creation = ResolvedType::parse_from_str("()").unwrap();
    let pre_lock_cancellation = ResolvedType::parse_from_str("(Signature)").unwrap();

    let path_type = ResolvedType::either(lending_creation, pre_lock_cancellation);

    let branch_str = match branch {
        PreLockBranch::LendingCreation => {
            format!("Left(())")
        }
        PreLockBranch::PreLockCancellation {
            cancellation_signature,
        } => {
            let sig_hex = hex::encode(cancellation_signature.serialize());
            format!("Right(0x{sig_hex})")
        }
    };

    simplicityhl::WitnessValues::from(HashMap::from([(
        WitnessName::from_str_unchecked("PATH"),
        simplicityhl::Value::parse_from_str(&branch_str, &path_type).unwrap(),
    )]))
}
