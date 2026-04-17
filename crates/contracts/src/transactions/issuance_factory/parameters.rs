use simplex::{provider::SimplicityNetwork, simplicityhl::elements::Transaction};

use crate::{
    programs::issuance_factory::{IssuanceFactory, IssuanceFactoryParameters},
    transactions::issuance_factory::IssuanceFactoryTransactionError,
};

pub const PRE_LOCK_ISSUING_UTXOS_COUNT: u8 = 2;
pub const PRE_LOCK_REISSUANCE_FLAGS: u64 = 0;

pub fn extract_issuance_factory_parameters_from_tx(
    tx: &Transaction,
    network: SimplicityNetwork,
) -> Result<IssuanceFactoryParameters, IssuanceFactoryTransactionError> {
    if tx.output.len() < 2 || !tx.output[1].is_null_data() {
        return Err(IssuanceFactoryTransactionError::NotAnIssuanceFactoryCreationTx(tx.txid()));
    }

    let mut op_return_instr_iter = tx.output[5].script_pubkey.instructions_minimal();

    op_return_instr_iter.next();

    let op_return_bytes = op_return_instr_iter
        .next()
        .unwrap()
        .unwrap()
        .push_bytes()
        .unwrap();

    let owner_pubkey = IssuanceFactory::decode_creation_op_return_data(op_return_bytes.to_vec())?;

    let issuance_factory_parameters = IssuanceFactoryParameters {
        issuing_utxos_count: PRE_LOCK_ISSUING_UTXOS_COUNT,
        reissuance_flags: PRE_LOCK_REISSUANCE_FLAGS,
        owner_pubkey,
        network,
    };

    Ok(issuance_factory_parameters)
}
