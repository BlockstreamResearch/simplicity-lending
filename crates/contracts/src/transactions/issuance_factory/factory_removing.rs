use simplex::simplicityhl::elements::Script;
use simplex::transaction::{FinalTransaction, PartialOutput, UTXO};

use crate::programs::{IssuanceFactory, IssuanceFactoryBranch, program::SimplexProgram};

pub fn remove_factory(
    issuance_factory_utxo: UTXO,
    issuance_factory: IssuanceFactory,
) -> FinalTransaction {
    let mut ft = FinalTransaction::new();

    let issuance_factory_amount = issuance_factory_utxo.explicit_amount();
    let issuance_factory_asset = issuance_factory_utxo.explicit_asset();

    let issuance_factory_witness =
        IssuanceFactory::get_issuance_factory_witness(&IssuanceFactoryBranch::RemoveFactory {
            output_index: 0,
        });
    issuance_factory.add_program_input_with_signature(
        &mut ft,
        issuance_factory_utxo,
        Box::new(issuance_factory_witness),
        "SIGNATURE".into(),
    );

    ft.add_output(PartialOutput::new(
        Script::new_op_return(b"burn"),
        issuance_factory_amount,
        issuance_factory_asset,
    ));

    ft
}
