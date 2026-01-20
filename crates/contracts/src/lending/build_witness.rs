use std::collections::HashMap;

use simplicityhl::{
    ResolvedType, WitnessValues, parse::ParseFromStr, str::WitnessName, types::TypeConstructible,
};

#[derive(Debug, Clone, Copy)]
pub enum LendingBranch {
    LoanRepayment,
    LoanLiquidation,
}

/// Build witness values for lending program execution.
///
/// # Panics
/// Panics if type parsing fails (should never happen with valid constants).
#[must_use]
pub fn build_lending_witness(branch: LendingBranch) -> WitnessValues {
    let zero_params = ResolvedType::parse_from_str("()").unwrap();
    let path_type = ResolvedType::either(zero_params.clone(), zero_params);

    let branch_str = match branch {
        LendingBranch::LoanRepayment => "Left(())".to_string(),
        LendingBranch::LoanLiquidation => "Right(())".to_string(),
    };

    simplicityhl::WitnessValues::from(HashMap::from([(
        WitnessName::from_str_unchecked("PATH"),
        simplicityhl::Value::parse_from_str(&branch_str, &path_type).unwrap(),
    )]))
}
