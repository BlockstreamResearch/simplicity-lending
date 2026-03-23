use simplex::transaction::{PartialInput, PartialOutput, RequiredSignature};
use simplicityhl::elements::{AssetId, OutPoint, Script, TxOut};

pub struct SimplexInput {
    partial_input: PartialInput,
    required_sig: RequiredSignature,
}

impl SimplexInput {
    pub fn new(outpoint: OutPoint, txout: TxOut, required_sig: RequiredSignature) -> Self {
        Self {
            partial_input: PartialInput::new(outpoint, txout),
            required_sig,
        }
    }

    pub fn from_utxo(utxo: &(OutPoint, TxOut), required_sig: RequiredSignature) -> Self {
        SimplexInput::new(utxo.0, utxo.1.clone(), required_sig)
    }

    pub fn explicit_asset(&self) -> AssetId {
        self.partial_input.asset.expect("Not an explicit asset")
    }

    pub fn explicit_amount(&self) -> u64 {
        self.partial_input.amount.expect("Not an explicit amount")
    }

    pub fn utxo_script_pubkey(&self) -> Script {
        self.partial_input.witness_utxo.script_pubkey.clone()
    }

    pub fn new_partial_output(&self) -> PartialOutput {
        PartialOutput::new(
            self.utxo_script_pubkey(),
            self.explicit_amount(),
            self.explicit_asset(),
        )
    }

    pub fn new_burn_partial_output(&self) -> PartialOutput {
        PartialOutput::new(
            Script::new_op_return(b"burn"),
            self.explicit_amount(),
            self.explicit_asset(),
        )
    }

    pub fn partial_input(&self) -> &PartialInput {
        &self.partial_input
    }

    pub fn required_sig(&self) -> &RequiredSignature {
        &self.required_sig
    }
}
