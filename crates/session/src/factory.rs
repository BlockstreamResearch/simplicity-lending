use lending_contracts::programs::issuance_factory::{IssuanceFactory, IssuanceFactoryParameters};
use lending_contracts::programs::program::SimplexProgram;
use lending_contracts::utils::get_random_seed;
use simplex::provider::ProviderTrait;
use simplex::simplicityhl::elements::hex::ToHex;
use simplex::simplicityhl::elements::{AssetId, Txid};
use simplex::transaction::partial_input::IssuanceInput;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use crate::error::SessionError;
use crate::session::Session;

const FACTORY_ASSET_TOTAL_AMOUNT: u64 = 2;

pub struct CreateFactoryTx {
    pub transaction: FinalTransaction,
    pub factory_asset_id: AssetId,
}

impl Session {
    pub async fn create_factory(
        &self,
        issuing_utxos_count: u8,
        reissuance_flags: u64,
    ) -> Result<CreateFactoryTx, SessionError> {
        let script_hex = self.signer.get_address().script_pubkey().to_hex();
        let existing = self.indexer.get_factories_by_script(&script_hex).await?;
        if !existing.is_empty() {
            return Err(SessionError::BorrowerAccountAlreadyExists);
        }

        let network = self.network();

        let policy_utxo = self
            .signer
            .get_utxos_asset(network.policy_asset())?
            .into_iter()
            .next()
            .ok_or(SessionError::NoPolicyUtxos)?;

        let parameters = IssuanceFactoryParameters {
            issuing_utxos_count,
            reissuance_flags,
            network,
        };
        let factory = IssuanceFactory::new(parameters);
        let entropy = get_random_seed();

        let mut ft = FinalTransaction::new();

        let issuance_details = ft.add_issuance_input(
            PartialInput::new(policy_utxo),
            IssuanceInput::new_issuance(FACTORY_ASSET_TOTAL_AMOUNT, 0, entropy),
            RequiredSignature::NativeEcdsa,
        );

        ft.add_output(PartialOutput::new(
            self.signer.get_address().script_pubkey(),
            1,
            issuance_details.asset_id,
        ));

        factory.attach_creation(&mut ft, issuance_details.asset_id, 1);

        Ok(CreateFactoryTx {
            transaction: ft,
            factory_asset_id: issuance_details.asset_id,
        })
    }

    pub fn remove_factory(&self, creation_txid: Txid) -> Result<FinalTransaction, SessionError> {
        let creation_tx = self.provider.fetch_transaction(&creation_txid)?;
        let (factory, factory_asset_id) =
            IssuanceFactory::try_from_tx(&creation_tx, self.network())?;

        let program_utxo = self
            .provider
            .fetch_scripthash_utxos(&factory.get_script_pubkey())?
            .into_iter()
            .find(|utxo| utxo.explicit_asset() == factory_asset_id)
            .ok_or(SessionError::FactoryProgramUtxoNotFound)?;

        let auth_nft_utxo = self
            .signer
            .get_utxos_asset(factory_asset_id)?
            .into_iter()
            .next()
            .ok_or(SessionError::AuthNftUtxoNotFound)?;

        let mut ft = FinalTransaction::new();
        factory.attach_factory_removing(&mut ft, program_utxo);
        ft.add_input(
            PartialInput::new(auth_nft_utxo),
            RequiredSignature::NativeEcdsa,
        );

        Ok(ft)
    }
}
