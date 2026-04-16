use simplex::{
    simplicityhl::elements::Script,
    transaction::{FinalTransaction, PartialOutput, UTXO, partial_input::IssuanceInput},
};

use crate::{
    programs::{IssuanceFactory, IssuanceFactoryBranch, program::SimplexProgram},
    transactions::core::SimplexInput,
};

pub fn issue_assets(
    issuance_factory_input: (UTXO, IssuanceInput),
    issuance_input: (&SimplexInput, IssuanceInput),
    first_issued_output_script: Script,
    second_issued_output_script: Script,
    issuance_factory: IssuanceFactory,
) -> FinalTransaction {
    let mut ft = FinalTransaction::new();

    let issuance_factory_amount = issuance_factory_input.0.explicit_amount();
    let issuance_factory_asset = issuance_factory_input.0.explicit_asset();

    let first_output_amount = issuance_factory_input.1.issuance_amount;
    let second_output_amount = issuance_input.1.issuance_amount;

    let issuance_factory_witness =
        IssuanceFactory::get_issuance_factory_witness(&IssuanceFactoryBranch::IssueAssets {
            output_index: 0,
        });
    let first_asset_id = issuance_factory.add_program_issuance_input_with_signature(
        &mut ft,
        issuance_factory_input.0,
        issuance_factory_input.1,
        Box::new(issuance_factory_witness),
        "SIGNATURE".into(),
    );
    let second_asset_id = ft.add_issuance_input(
        issuance_input.0.partial_input().clone(),
        issuance_input.1,
        issuance_input.0.required_sig().clone(),
    );

    issuance_factory.add_program_output(&mut ft, issuance_factory_asset, issuance_factory_amount);

    ft.add_output(PartialOutput::new(
        first_issued_output_script,
        first_output_amount,
        first_asset_id,
    ));
    ft.add_output(PartialOutput::new(
        second_issued_output_script,
        second_output_amount,
        second_asset_id,
    ));

    ft
}
