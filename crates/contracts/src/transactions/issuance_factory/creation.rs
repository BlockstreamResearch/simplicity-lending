use simplex::simplicityhl::elements::{AssetId, Script};
use simplex::transaction::partial_input::IssuanceInput;
use simplex::transaction::{FinalTransaction, PartialOutput};

use crate::programs::{IssuanceFactory, IssuanceFactoryParameters, program::SimplexProgram};
use crate::transactions::core::SimplexInput;
use crate::utils::get_random_seed;

pub const ISSUANCE_FACTORY_ASSET_AMOUNT: u64 = 1;

pub fn create_issuance_factory(
    issuance_input: &SimplexInput,
    parameters: IssuanceFactoryParameters,
) -> (FinalTransaction, IssuanceFactory) {
    let mut ft = FinalTransaction::new();

    let asset_entropy = get_random_seed();

    let factory_asset_id = ft.add_issuance_input(
        issuance_input.partial_input().clone(),
        IssuanceInput::new(ISSUANCE_FACTORY_ASSET_AMOUNT, asset_entropy),
        issuance_input.required_sig().clone(),
    );

    let issuance_factory = IssuanceFactory::new(parameters);

    issuance_factory.add_program_output(&mut ft, factory_asset_id, ISSUANCE_FACTORY_ASSET_AMOUNT);

    let op_return_data = issuance_factory.encode_creation_op_return_data();

    ft.add_output(PartialOutput::new(
        Script::new_op_return(&op_return_data),
        0,
        AssetId::default(),
    ));

    (ft, issuance_factory)
}
