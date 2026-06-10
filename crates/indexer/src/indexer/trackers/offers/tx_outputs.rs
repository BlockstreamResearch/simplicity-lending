use lending_contracts::programs::lending::LendingOfferParameters;
use simplex::simplicityhl::elements::{AssetId, Script, Transaction, TxOut};

#[derive(Debug, Clone)]
pub struct OfferCreationOutputs {
    pub pending_offer_vout: u32,
    pub borrower_nft_vout: u32,
    pub borrower_nft_script_pubkey: Vec<u8>,
    pub lender_nft_vout: u32,
    pub lender_nft_script_pubkey: Vec<u8>,
}

pub fn is_pending_offer_output(
    output: &TxOut,
    parameters: &LendingOfferParameters,
    program_script_pubkey: &Script,
) -> bool {
    let (Some(asset_id), Some(amount)) = (output.asset.explicit(), output.value.explicit()) else {
        return false;
    };

    asset_id == parameters.collateral_asset_id
        && amount == parameters.offer_parameters.collateral_amount
        && output.script_pubkey == *program_script_pubkey
}

pub fn is_participant_nft_output(output: &TxOut, asset_id: AssetId) -> bool {
    let (Some(output_asset_id), Some(amount)) = (output.asset.explicit(), output.value.explicit())
    else {
        return false;
    };

    output_asset_id == asset_id && amount == 1 && !output.script_pubkey.is_op_return()
}

pub fn scan_offer_creation_outputs(
    parameters: &LendingOfferParameters,
    program_script_pubkey: &Script,
    tx: &Transaction,
) -> Option<OfferCreationOutputs> {
    let mut pending_offer_vout = None;
    let mut borrower = None;
    let mut lender = None;

    for (vout, output) in tx.output.iter().enumerate() {
        if is_pending_offer_output(output, parameters, program_script_pubkey) {
            pending_offer_vout = Some(vout as u32);
        } else if is_participant_nft_output(output, parameters.borrower_nft_asset_id) {
            borrower = Some((vout as u32, output.script_pubkey.to_bytes()));
        } else if is_participant_nft_output(output, parameters.lender_nft_asset_id) {
            lender = Some((vout as u32, output.script_pubkey.to_bytes()));
        }
    }

    let pending_offer_vout = pending_offer_vout?;
    let (borrower_nft_vout, borrower_nft_script_pubkey) = borrower?;
    let (lender_nft_vout, lender_nft_script_pubkey) = lender?;

    Some(OfferCreationOutputs {
        pending_offer_vout,
        borrower_nft_vout,
        borrower_nft_script_pubkey,
        lender_nft_vout,
        lender_nft_script_pubkey,
    })
}
