use simplex::simplicityhl::elements::{Transaction, TxOut};

use crate::models::FactoryIdentity;

#[derive(Debug, Clone)]
pub struct FactoryCreationOutputs {
    pub program_vout: u32,
    pub auth_vout: u32,
    pub auth_script_pubkey: Vec<u8>,
}

#[derive(Debug, Clone)]
pub enum ProgramOutputMatch {
    Unique(u32),
    Ambiguous { first_vout: u32, count: usize },
}

impl ProgramOutputMatch {
    pub fn vout(&self) -> u32 {
        match self {
            Self::Unique(vout) => *vout,
            Self::Ambiguous { first_vout, .. } => *first_vout,
        }
    }
}

pub fn is_program_output(identity: &FactoryIdentity, output: &TxOut) -> bool {
    is_asset_utxo(identity, output)
        && output.script_pubkey.as_bytes() == identity.program_script_pubkey.as_slice()
}

pub fn is_auth_output(identity: &FactoryIdentity, output: &TxOut) -> bool {
    is_asset_utxo(identity, output)
        && output.script_pubkey.as_bytes() != identity.program_script_pubkey.as_slice()
}

pub fn find_program_output(
    identity: &FactoryIdentity,
    tx: &Transaction,
) -> Option<ProgramOutputMatch> {
    let matches: Vec<(u32, &TxOut)> = tx
        .output
        .iter()
        .enumerate()
        .filter_map(|(vout, output)| {
            if is_program_output(identity, output) {
                Some((vout as u32, output))
            } else {
                None
            }
        })
        .collect();

    match matches.as_slice() {
        [] => None,
        [(vout, _)] => Some(ProgramOutputMatch::Unique(*vout)),
        [(vout, _), rest @ ..] => Some(ProgramOutputMatch::Ambiguous {
            first_vout: *vout,
            count: rest.len() + 1,
        }),
    }
}

pub fn scan_creation_outputs(
    identity: &FactoryIdentity,
    tx: &Transaction,
) -> Option<FactoryCreationOutputs> {
    let mut program_vout = None;
    let mut auth = None;

    for (vout, output) in tx.output.iter().enumerate() {
        if is_program_output(identity, output) {
            program_vout = Some(vout as u32);
        } else if is_auth_output(identity, output) {
            auth = Some((vout as u32, output.script_pubkey.to_bytes()));
        }
    }

    let program_vout = program_vout?;
    let (auth_vout, auth_script_pubkey) = auth?;

    Some(FactoryCreationOutputs {
        program_vout,
        auth_vout,
        auth_script_pubkey,
    })
}

fn is_asset_utxo(identity: &FactoryIdentity, output: &TxOut) -> bool {
    let (Some(asset_id), Some(amount)) = (output.asset.explicit(), output.value.explicit()) else {
        return false;
    };

    asset_id.into_inner().0.as_slice() == identity.factory_asset_id.as_slice()
        && amount == 1
        && !output.script_pubkey.is_op_return()
}
