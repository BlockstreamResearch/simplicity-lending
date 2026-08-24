use std::str::FromStr;

use lending_contracts::programs::asset_auth::AssetAuthWitnessParams;
use lending_contracts::programs::issuance_factory::{IssuanceFactory, IssuanceFactoryParameters};
use lending_contracts::programs::lending::{LendingOffer, LendingOfferParameters};
use lending_contracts::programs::program::SimplexProgram;
use lending_contracts::programs::script_auth::ScriptAuth;
use lending_contracts::utils::get_random_seed;
use simplex::provider::{ProviderTrait, SimplicityNetwork};
use simplex::simplicityhl::elements::hex::ToHex;
use simplex::simplicityhl::elements::{AssetId, Script};
use simplex::transaction::partial_input::IssuanceInput;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, RequiredSignature};

use crate::error::SessionError;
use crate::indexer::{OfferListItemFull, OfferStatus, ParticipantType, UtxoType, VaultType};
use crate::session::Session;
use crate::utxo::select_utxos_for_amount;

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

pub struct AcceptOfferTx {
    pub transaction: FinalTransaction,
    pub active_offer: LendingOffer,
}

fn parse_asset_id(field: &'static str, value: &str) -> Result<AssetId, SessionError> {
    AssetId::from_str(value).map_err(|_| SessionError::InvalidOfferData {
        field,
        value: value.to_owned(),
    })
}

fn parse_amount(field: &'static str, value: &str) -> Result<u64, SessionError> {
    value.parse().map_err(|_| SessionError::InvalidOfferData {
        field,
        value: value.to_owned(),
    })
}

fn parse_interest_rate(value: u32) -> Result<u16, SessionError> {
    u16::try_from(value).map_err(|_| SessionError::InvalidOfferData {
        field: "interest_rate",
        value: value.to_string(),
    })
}

fn lending_offer_parameters_from_indexer(
    info: &OfferListItemFull,
    network: SimplicityNetwork,
) -> Result<LendingOfferParameters, SessionError> {
    Ok(LendingOfferParameters {
        collateral_asset_id: parse_asset_id("collateral_asset", &info.base.collateral_asset)?,
        principal_asset_id: parse_asset_id("principal_asset", &info.base.principal_asset)?,
        borrower_nft_asset_id: parse_asset_id("borrower_nft_asset", &info.borrower_nft_asset)?,
        lender_nft_asset_id: parse_asset_id("lender_nft_asset", &info.lender_nft_asset)?,
        protocol_fee_keeper_asset_id: parse_asset_id(
            "protocol_fee_keeper_asset",
            &info.protocol_fee_keeper_asset,
        )?,
        offer_parameters: OfferParameters {
            collateral_amount: parse_amount("collateral_amount", &info.base.collateral_amount)?,
            principal_amount: parse_amount("principal_amount", &info.base.principal_amount)?,
            loan_expiration_time: info.base.loan_expiration_height,
            principal_interest_rate: parse_interest_rate(info.base.interest_rate)?,
        },
        network,
    })
}

fn pending_offer_from_indexer(
    info: &OfferListItemFull,
    network: SimplicityNetwork,
) -> Result<LendingOffer, SessionError> {
    let parameters = lending_offer_parameters_from_indexer(info, network)?;

    Ok(LendingOffer::new_pending(parameters))
}

fn active_offer_from_indexer(
    info: &OfferListItemFull,
    network: SimplicityNetwork,
) -> Result<LendingOffer, SessionError> {
    let parameters = lending_offer_parameters_from_indexer(info, network)?;
    let current_debt = parameters.offer_parameters.get_total_amount_to_repay();

    Ok(LendingOffer::new_active(parameters, current_debt))
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
        let mut collateral_utxos = select_utxos_for_amount(
            self.signer().get_utxos_asset(collateral_asset_id)?,
            collateral_asset_id,
            params.offer_parameters.collateral_amount,
        )
        .ok_or(SessionError::CollateralUtxoNotFound)?
        .into_utxos();
        let issuance_collateral_utxo = collateral_utxos.remove(0);

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
            PartialInput::new(issuance_collateral_utxo),
            IssuanceInput::new_issuance(1, 0, nfts_entropy),
            RequiredSignature::NativeEcdsa,
        );
        for collateral_utxo in collateral_utxos {
            transaction.add_input(
                PartialInput::new(collateral_utxo),
                RequiredSignature::NativeEcdsa,
            );
        }

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

    pub async fn cancel_offer(&self, offer_id: &str) -> Result<FinalTransaction, SessionError> {
        let offer_details = self.indexer().get_offer(offer_id).await?;
        if offer_details.info.base.status != OfferStatus::Pending {
            return Err(SessionError::OfferNotPending);
        }

        let pending_outpoint = offer_details
            .utxos
            .iter()
            .find(|utxo| utxo.utxo_type == UtxoType::PendingOffer)
            .ok_or(SessionError::PendingOfferUtxoNotFound)?;
        let lender_nft_outpoint = offer_details
            .participants
            .iter()
            .find(|participant| {
                participant.participant_type == ParticipantType::Lender
                    && participant.spent_txid.is_none()
            })
            .ok_or(SessionError::LenderNftUtxoNotFound)?;
        let borrower_nft_outpoint = offer_details
            .participants
            .iter()
            .find(|participant| {
                participant.participant_type == ParticipantType::Borrower
                    && participant.spent_txid.is_none()
            })
            .ok_or(SessionError::BorrowerNftUtxoNotFound)?;

        let pending_offer = pending_offer_from_indexer(&offer_details.info, self.network())?;
        let parameters = *pending_offer.get_parameters();

        let pending_offer_utxo = self
            .provider()
            .fetch_scripthash_utxos(&pending_offer.get_script_pubkey())?
            .into_iter()
            .find(|utxo| {
                utxo.outpoint.vout == pending_outpoint.vout
                    && utxo.outpoint.txid.to_string() == pending_outpoint.txid
            })
            .ok_or(SessionError::PendingOfferUtxoNotFound)?;

        let lender_nft_auth = ScriptAuth::from_simplex_program(&pending_offer);
        let lender_nft_utxo = self
            .provider()
            .fetch_scripthash_utxos(&lender_nft_auth.get_script_pubkey())?
            .into_iter()
            .find(|utxo| {
                utxo.outpoint.vout == lender_nft_outpoint.vout
                    && utxo.outpoint.txid.to_string() == lender_nft_outpoint.txid
                    && utxo.txout.asset.explicit() == Some(parameters.lender_nft_asset_id)
                    && utxo.txout.value.explicit() == Some(1)
            })
            .ok_or(SessionError::LenderNftUtxoNotFound)?;

        let borrower_nft_utxo = self
            .signer()
            .get_utxos_asset(parameters.borrower_nft_asset_id)?
            .into_iter()
            .find(|utxo| {
                utxo.outpoint.vout == borrower_nft_outpoint.vout
                    && utxo.outpoint.txid.to_string() == borrower_nft_outpoint.txid
                    && utxo.txout.asset.explicit() == Some(parameters.borrower_nft_asset_id)
                    && utxo.txout.value.explicit() == Some(1)
            })
            .ok_or(SessionError::BorrowerNftUtxoNotFound)?;

        let mut transaction = FinalTransaction::new();
        pending_offer.attach_cancellation(&mut transaction, pending_offer_utxo, lender_nft_utxo);
        transaction.add_input(
            PartialInput::new(borrower_nft_utxo),
            RequiredSignature::NativeEcdsa,
        );
        transaction.add_output(
            PartialOutput::new(
                self.signer().get_confidential_address().script_pubkey(),
                parameters.offer_parameters.collateral_amount,
                parameters.collateral_asset_id,
            )
            .with_blinding_key(self.signer().get_blinding_public_key()),
        );

        Ok(transaction)
    }

    pub async fn accept_offer(&self, offer_id: &str) -> Result<AcceptOfferTx, SessionError> {
        let offer_details = self.indexer().get_offer(offer_id).await?;
        if offer_details.info.base.status != OfferStatus::Pending {
            return Err(SessionError::OfferNotPending);
        }
        let signer_script_hex = self.signer().get_address().script_pubkey().to_hex();
        if offer_details.participants.iter().any(|participant| {
            participant.participant_type == ParticipantType::Borrower
                && participant.spent_txid.is_none()
                && participant
                    .script_pubkey
                    .eq_ignore_ascii_case(&signer_script_hex)
        }) {
            return Err(SessionError::BorrowerCannotAcceptOwnOffer);
        }

        let pending_outpoint = offer_details
            .utxos
            .iter()
            .find(|utxo| utxo.utxo_type == UtxoType::PendingOffer)
            .ok_or(SessionError::PendingOfferUtxoNotFound)?;
        let lender_nft_outpoint = offer_details
            .participants
            .iter()
            .find(|participant| {
                participant.participant_type == ParticipantType::Lender
                    && participant.spent_txid.is_none()
            })
            .ok_or(SessionError::LenderNftUtxoNotFound)?;

        let mut offer = pending_offer_from_indexer(&offer_details.info, self.network())?;
        let parameters = *offer.get_parameters();
        let principal_amount = parameters.offer_parameters.principal_amount;

        let pending_offer_utxo = self
            .provider()
            .fetch_scripthash_utxos(&offer.get_script_pubkey())?
            .into_iter()
            .find(|utxo| {
                utxo.outpoint.vout == pending_outpoint.vout
                    && utxo.outpoint.txid.to_string() == pending_outpoint.txid
            })
            .ok_or(SessionError::PendingOfferUtxoNotFound)?;

        let lender_nft_auth = ScriptAuth::from_simplex_program(&offer);
        let lender_nft_utxo = self
            .provider()
            .fetch_scripthash_utxos(&lender_nft_auth.get_script_pubkey())?
            .into_iter()
            .find(|utxo| {
                utxo.outpoint.vout == lender_nft_outpoint.vout
                    && utxo.outpoint.txid.to_string() == lender_nft_outpoint.txid
                    && utxo.txout.asset.explicit() == Some(parameters.lender_nft_asset_id)
                    && utxo.txout.value.explicit() == Some(1)
            })
            .ok_or(SessionError::LenderNftUtxoNotFound)?;

        let principal_utxos = select_utxos_for_amount(
            self.signer()
                .get_utxos_asset(parameters.principal_asset_id)?,
            parameters.principal_asset_id,
            principal_amount,
        )
        .ok_or(SessionError::PrincipalUtxoNotFound)?;

        let mut transaction = FinalTransaction::new();
        offer.attach_acceptance(&mut transaction, pending_offer_utxo, lender_nft_utxo);

        for principal_utxo in principal_utxos.utxos() {
            transaction.add_input(
                PartialInput::new(principal_utxo.clone()),
                RequiredSignature::NativeEcdsa,
            );
        }
        transaction.add_output(PartialOutput::new(
            self.signer().get_address().script_pubkey(),
            1,
            parameters.lender_nft_asset_id,
        ));

        if principal_utxos.has_change() {
            let change_output = PartialOutput::new(
                self.signer().get_address().script_pubkey(),
                principal_utxos.change_amount(),
                principal_utxos.asset_id(),
            );
            let change_output = if principal_utxos.any_confidential() {
                change_output.with_blinding_key(self.signer().get_blinding_public_key())
            } else {
                change_output
            };
            transaction.add_output(change_output);
        }

        Ok(AcceptOfferTx {
            transaction,
            active_offer: offer,
        })
    }

    pub async fn liquidate_offer(&self, offer_id: &str) -> Result<FinalTransaction, SessionError> {
        let offer_details = self.indexer().get_offer(offer_id).await?;
        if offer_details.info.base.status != OfferStatus::Active {
            return Err(SessionError::OfferNotActive);
        }

        let active_offer_outpoint = offer_details
            .utxos
            .iter()
            .find(|utxo| utxo.utxo_type == UtxoType::ActiveOffer)
            .ok_or(SessionError::ActiveOfferUtxoNotFound)?;
        let lender_nft_outpoint = offer_details
            .participants
            .iter()
            .find(|participant| {
                participant.participant_type == ParticipantType::Lender
                    && participant.spent_txid.is_none()
            })
            .ok_or(SessionError::LenderNftUtxoNotFound)?;

        let active_offer = active_offer_from_indexer(&offer_details.info, self.network())?;
        let parameters = *active_offer.get_parameters();

        if self.provider().fetch_tip_height()? < parameters.offer_parameters.loan_expiration_time {
            return Err(SessionError::LoanNotExpired);
        }

        let active_offer_utxo = self
            .provider()
            .fetch_scripthash_utxos(&active_offer.get_script_pubkey())?
            .into_iter()
            .find(|utxo| {
                utxo.outpoint.vout == active_offer_outpoint.vout
                    && utxo.outpoint.txid.to_string() == active_offer_outpoint.txid
            })
            .ok_or(SessionError::ActiveOfferUtxoNotFound)?;

        let lender_nft_utxo = self
            .signer()
            .get_utxos_asset(parameters.lender_nft_asset_id)?
            .into_iter()
            .find(|utxo| {
                utxo.outpoint.vout == lender_nft_outpoint.vout
                    && utxo.outpoint.txid.to_string() == lender_nft_outpoint.txid
                    && utxo.txout.asset.explicit() == Some(parameters.lender_nft_asset_id)
                    && utxo.txout.value.explicit() == Some(1)
            })
            .ok_or(SessionError::LenderNftUtxoNotFound)?;

        let mut transaction = FinalTransaction::new();
        active_offer.attach_liquidation(&mut transaction, active_offer_utxo);

        transaction.add_input(
            PartialInput::new(lender_nft_utxo),
            RequiredSignature::NativeEcdsa,
        );
        transaction.add_output(PartialOutput::new(
            self.signer().get_address().script_pubkey(),
            parameters.offer_parameters.collateral_amount,
            parameters.collateral_asset_id,
        ));

        Ok(transaction)
    }

    pub async fn repay_offer(&self, offer_id: &str) -> Result<FinalTransaction, SessionError> {
        let offer_details = self.indexer().get_offer(offer_id).await?;
        if offer_details.info.base.status != OfferStatus::Active {
            return Err(SessionError::OfferNotActive);
        }

        let active_offer_outpoint = offer_details
            .utxos
            .iter()
            .find(|utxo| utxo.utxo_type == UtxoType::ActiveOffer)
            .ok_or(SessionError::ActiveOfferUtxoNotFound)?;
        let borrower_nft_outpoint = offer_details
            .participants
            .iter()
            .find(|participant| {
                participant.participant_type == ParticipantType::Borrower
                    && participant.spent_txid.is_none()
            })
            .ok_or(SessionError::BorrowerNftUtxoNotFound)?;

        let mut active_offer = active_offer_from_indexer(&offer_details.info, self.network())?;
        let parameters = *active_offer.get_parameters();
        let total_amount_to_repay = parameters.offer_parameters.get_total_amount_to_repay();

        let active_offer_utxo = self
            .provider()
            .fetch_scripthash_utxos(&active_offer.get_script_pubkey())?
            .into_iter()
            .find(|utxo| {
                utxo.outpoint.vout == active_offer_outpoint.vout
                    && utxo.outpoint.txid.to_string() == active_offer_outpoint.txid
            })
            .ok_or(SessionError::ActiveOfferUtxoNotFound)?;

        let borrower_nft_utxo = self
            .signer()
            .get_utxos_asset(parameters.borrower_nft_asset_id)?
            .into_iter()
            .find(|utxo| {
                utxo.outpoint.vout == borrower_nft_outpoint.vout
                    && utxo.outpoint.txid.to_string() == borrower_nft_outpoint.txid
                    && utxo.txout.asset.explicit() == Some(parameters.borrower_nft_asset_id)
                    && utxo.txout.value.explicit() == Some(1)
            })
            .ok_or(SessionError::BorrowerNftUtxoNotFound)?;

        let principal_utxos = select_utxos_for_amount(
            self.signer()
                .get_utxos_asset(parameters.principal_asset_id)?,
            parameters.principal_asset_id,
            total_amount_to_repay,
        )
        .ok_or(SessionError::PrincipalUtxoNotFound)?;

        let mut transaction = FinalTransaction::new();

        transaction.add_input(
            PartialInput::new(borrower_nft_utxo),
            RequiredSignature::NativeEcdsa,
        );

        active_offer.attach_full_repayment(&mut transaction, active_offer_utxo, None, None);

        for principal_utxo in principal_utxos.utxos() {
            transaction.add_input(
                PartialInput::new(principal_utxo.clone()),
                RequiredSignature::NativeEcdsa,
            );
        }

        transaction.add_output(
            PartialOutput::new(
                self.signer().get_confidential_address().script_pubkey(),
                parameters.offer_parameters.collateral_amount,
                parameters.collateral_asset_id,
            )
            .with_blinding_key(self.signer().get_blinding_public_key()),
        );

        if principal_utxos.has_change() {
            let change_output = PartialOutput::new(
                self.signer().get_address().script_pubkey(),
                principal_utxos.change_amount(),
                principal_utxos.asset_id(),
            );
            let change_output = if principal_utxos.any_confidential() {
                change_output.with_blinding_key(self.signer().get_blinding_public_key())
            } else {
                change_output
            };
            transaction.add_output(change_output);
        }

        Ok(transaction)
    }

    pub async fn claim_principal(&self, offer_id: &str) -> Result<FinalTransaction, SessionError> {
        let offer_details = self.indexer().get_offer(offer_id).await?;
        if offer_details.info.base.status != OfferStatus::Active {
            return Err(SessionError::OfferNotActive);
        }

        let borrower_principal_outpoint = offer_details
            .utxos
            .iter()
            .find(|utxo| utxo.utxo_type == UtxoType::BorrowerPrincipal)
            .ok_or(SessionError::BorrowerPrincipalUtxoNotFound)?;
        let borrower_nft_outpoint = offer_details
            .participants
            .iter()
            .find(|participant| {
                participant.participant_type == ParticipantType::Borrower
                    && participant.spent_txid.is_none()
            })
            .ok_or(SessionError::BorrowerNftUtxoNotFound)?;

        let active_offer = active_offer_from_indexer(&offer_details.info, self.network())?;
        let parameters = *active_offer.get_parameters();
        let principal_asset_auth = parameters.get_principal_output_asset_auth();

        let borrower_principal_utxo = self
            .provider()
            .fetch_scripthash_utxos(&principal_asset_auth.get_script_pubkey())?
            .into_iter()
            .find(|utxo| {
                utxo.outpoint.vout == borrower_principal_outpoint.vout
                    && utxo.outpoint.txid.to_string() == borrower_principal_outpoint.txid
                    && utxo.txout.asset.explicit() == Some(parameters.principal_asset_id)
            })
            .ok_or(SessionError::BorrowerPrincipalUtxoNotFound)?;

        let borrower_nft_utxo = self
            .signer()
            .get_utxos_asset(parameters.borrower_nft_asset_id)?
            .into_iter()
            .find(|utxo| {
                utxo.outpoint.vout == borrower_nft_outpoint.vout
                    && utxo.outpoint.txid.to_string() == borrower_nft_outpoint.txid
                    && utxo.txout.asset.explicit() == Some(parameters.borrower_nft_asset_id)
                    && utxo.txout.value.explicit() == Some(1)
            })
            .ok_or(SessionError::BorrowerNftUtxoNotFound)?;

        let principal_amount = borrower_principal_utxo.explicit_amount();

        let mut transaction = FinalTransaction::new();

        principal_asset_auth.attach_unlocking(
            &mut transaction,
            borrower_principal_utxo,
            AssetAuthWitnessParams::new(1, 0),
        );
        transaction.add_input(
            PartialInput::new(borrower_nft_utxo),
            RequiredSignature::NativeEcdsa,
        );
        transaction.add_output(PartialOutput::new(
            self.signer().get_address().script_pubkey(),
            1,
            parameters.borrower_nft_asset_id,
        ));
        transaction.add_output(
            PartialOutput::new(
                self.signer().get_confidential_address().script_pubkey(),
                principal_amount,
                parameters.principal_asset_id,
            )
            .with_blinding_key(self.signer().get_blinding_public_key()),
        );

        Ok(transaction)
    }

    pub async fn claim_lender_vault(
        &self,
        offer_id: &str,
    ) -> Result<FinalTransaction, SessionError> {
        let offer_details = self.indexer().get_offer(offer_id).await?;
        if offer_details.info.base.status != OfferStatus::Repaid {
            return Err(SessionError::OfferNotRepaid);
        }

        let lender_vault_outpoint = offer_details
            .vaults
            .iter()
            .find(|vault| vault.vault_type == VaultType::Lender && vault.is_finalized)
            .ok_or(SessionError::LenderVaultNotFound)?;
        let lender_nft_outpoint = offer_details
            .participants
            .iter()
            .find(|participant| {
                participant.participant_type == ParticipantType::Lender
                    && participant.spent_txid.is_none()
            })
            .ok_or(SessionError::LenderNftUtxoNotFound)?;

        let parameters =
            lending_offer_parameters_from_indexer(&offer_details.info, self.network())?;
        let finalized_lender_vault = parameters.get_lender_vault(0);

        let lender_vault_utxo = self
            .provider()
            .fetch_scripthash_utxos(&finalized_lender_vault.get_script_pubkey())?
            .into_iter()
            .find(|utxo| {
                utxo.outpoint.vout == lender_vault_outpoint.vout
                    && utxo.outpoint.txid.to_string() == lender_vault_outpoint.txid
                    && utxo.txout.asset.explicit() == Some(parameters.principal_asset_id)
            })
            .ok_or(SessionError::LenderVaultNotFound)?;

        let lender_nft_utxo = self
            .signer()
            .get_utxos_asset(parameters.lender_nft_asset_id)?
            .into_iter()
            .find(|utxo| {
                utxo.outpoint.vout == lender_nft_outpoint.vout
                    && utxo.outpoint.txid.to_string() == lender_nft_outpoint.txid
                    && utxo.txout.asset.explicit() == Some(parameters.lender_nft_asset_id)
                    && utxo.txout.value.explicit() == Some(1)
            })
            .ok_or(SessionError::LenderNftUtxoNotFound)?;

        let principal_amount = lender_vault_utxo.explicit_amount();

        let mut transaction = FinalTransaction::new();

        finalized_lender_vault.attach_withdrawing_all(&mut transaction, lender_vault_utxo, 1, 0);
        transaction.add_input(
            PartialInput::new(lender_nft_utxo),
            RequiredSignature::NativeEcdsa,
        );
        transaction.add_output(PartialOutput::new(
            Script::new_op_return(b"burn"),
            1,
            parameters.lender_nft_asset_id,
        ));
        transaction.add_output(
            PartialOutput::new(
                self.signer().get_confidential_address().script_pubkey(),
                principal_amount,
                parameters.principal_asset_id,
            )
            .with_blinding_key(self.signer().get_blinding_public_key()),
        );

        Ok(transaction)
    }
}
