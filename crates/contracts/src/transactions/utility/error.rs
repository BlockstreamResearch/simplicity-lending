use crate::utils::ParametersError;

#[derive(thiserror::Error, Debug)]
pub enum UtilityTransactionError {
    #[error("Invalid issuance inputs count: expected - {expected_count}, actual - {actual_count}")]
    InvalidIssuanceInputsCount {
        expected_count: usize,
        actual_count: usize,
    },

    #[error(transparent)]
    OfferParameters(#[from] ParametersError),
}
