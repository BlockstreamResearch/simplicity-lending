use lending_contracts::programs::issuance_factory::{IssuanceFactory, IssuanceFactoryParameters};
use lending_contracts::programs::lending::{LendingOffer, LendingOfferParameters};
use lending_contracts::programs::program::SimplexProgram;
use lending_contracts::utils::get_random_seed;
use simplex::provider::ProviderTrait;
use simplex::simplicityhl::elements::AssetId;
use simplex::simplicityhl::elements::hex::ToHex;
use simplex::transaction::partial_input::IssuanceInput;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use crate::error::SessionError;
use crate::session::Session;

pub use lending_contracts::programs::lending::OfferParameters;

pub struct CreateOfferParams {
    pub principal_asset_id: AssetId,
    pub protocol_fee_keeper_asset_id: AssetId,
    pub offer_parameters: OfferParameters,
}

pub struct CreateOfferTx {
    pub transaction: FinalTransaction,
    pub pending_offer: LendingOffer,
}

impl Session {
    pub async fn create_offer(
        &self,
        params: CreateOfferParams,
    ) -> Result<CreateOfferTx, SessionError> {
        let script_hex = self.signer().get_address().script_pubkey().to_hex();
        let factory_info = self
            .indexer()
            .get_factories_by_script(&script_hex)
            .await?
            .into_iter()
            .next()
            .ok_or(SessionError::FactoryNotFound)?;

        let issuing_utxos_count = u8::try_from(factory_info.issuing_utxos_count)
            .map_err(|_| SessionError::InvalidState)?;
        let factory = IssuanceFactory::new(IssuanceFactoryParameters {
            issuing_utxos_count,
            reissuance_flags: factory_info.reissuance_flags,
            network: self.network(),
        });

        let program_outpoint = factory_info
            .program_utxo
            .ok_or(SessionError::FactoryProgramUtxoNotFound)?;
        let factory_program_utxo = self
            .provider()
            .fetch_scripthash_utxos(&factory.get_script_pubkey())?
            .into_iter()
            .find(|utxo| {
                utxo.outpoint.vout == program_outpoint.vout
                    && utxo.outpoint.txid.to_string() == program_outpoint.txid
            })
            .ok_or(SessionError::FactoryProgramUtxoNotFound)?;
        let factory_asset_id = factory_program_utxo.explicit_asset();

        let auth_outpoint = factory_info
            .auth_utxo
            .ok_or(SessionError::AuthNftUtxoNotFound)?;
        let factory_auth_utxo = self
            .signer()
            .get_utxos_asset(factory_asset_id)?
            .into_iter()
            .find(|utxo| {
                utxo.outpoint.vout == auth_outpoint.vout
                    && utxo.outpoint.txid.to_string() == auth_outpoint.txid
            })
            .ok_or(SessionError::AuthNftUtxoNotFound)?;

        let collateral_asset_id = self.network().policy_asset();
        let collateral_utxo = self
            .signer()
            .get_utxos_asset(collateral_asset_id)?
            .into_iter()
            .find(|utxo| utxo.explicit_amount() >= params.offer_parameters.collateral_amount)
            .ok_or(SessionError::CollateralUtxoNotFound)?;

        let nfts_entropy = get_random_seed();
        let mut transaction = FinalTransaction::new();

        transaction.add_input(
            PartialInput::new(factory_auth_utxo),
            RequiredSignature::NativeEcdsa,
        );
        transaction.add_output(PartialOutput::new(
            self.signer().get_address().script_pubkey(),
            1,
            factory_asset_id,
        ));

        let borrower_nft_issuance = factory.attach_assets_issuance(
            &mut transaction,
            factory_program_utxo,
            IssuanceInput::new_issuance(1, 0, nfts_entropy),
        );
        let lender_nft_issuance = transaction.add_issuance_input(
            PartialInput::new(collateral_utxo),
            IssuanceInput::new_issuance(1, 0, nfts_entropy),
            RequiredSignature::NativeEcdsa,
        );

        let lending_offer_parameters = LendingOfferParameters {
            collateral_asset_id,
            principal_asset_id: params.principal_asset_id,
            borrower_nft_asset_id: borrower_nft_issuance.asset_id,
            lender_nft_asset_id: lender_nft_issuance.asset_id,
            protocol_fee_keeper_asset_id: params.protocol_fee_keeper_asset_id,
            offer_parameters: params.offer_parameters,
            network: self.network(),
        };

        transaction.add_output(PartialOutput::new(
            self.signer().get_address().script_pubkey(),
            1,
            borrower_nft_issuance.asset_id,
        ));

        let pending_offer = LendingOffer::new_pending(lending_offer_parameters);
        pending_offer.attach_creation(&mut transaction);

        Ok(CreateOfferTx {
            transaction,
            pending_offer,
        })
    }
}
