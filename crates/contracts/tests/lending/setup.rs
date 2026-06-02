use simplex::signer::Signer;
use simplex::simplicityhl::elements::{AssetId, OutPoint, Txid};
use simplex::transaction::partial_input::IssuanceInput;
use simplex::transaction::{
    FinalTransaction, PartialInput, PartialOutput, RequiredSignature, UTXO,
};

use lending_contracts::programs::issuance_factory::{IssuanceFactory, IssuanceFactoryParameters};
use lending_contracts::programs::lending::{LendingOffer, LendingOfferParameters, OfferParameters};
use lending_contracts::programs::program::SimplexProgram;
use lending_contracts::utils::get_random_seed;

use super::common::issuance::issue_asset;

pub(super) fn setup_issuance_factory(
    context: &simplex::TestContext,
) -> anyhow::Result<IssuanceFactory> {
    let signer = context.get_default_signer();

    let signer_policy_utxo =
        signer.get_utxos_asset(context.get_network().policy_asset())?[0].clone();

    let issuance_factory_parameters = IssuanceFactoryParameters {
        issuing_utxos_count: 2,
        reissuance_flags: 0,
        network: *context.get_network(),
    };
    let issuance_factory = IssuanceFactory::new(issuance_factory_parameters);

    let mut ft = FinalTransaction::new();

    let issuance_factory_entropy = get_random_seed();
    let issuance_factory_asset_amount = 2;

    let issuance_details = ft.add_issuance_input(
        PartialInput::new(signer_policy_utxo),
        IssuanceInput::new_issuance(issuance_factory_asset_amount, 0, issuance_factory_entropy),
        RequiredSignature::NativeEcdsa,
    );

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        1,
        issuance_details.asset_id,
    ));

    issuance_factory.attach_creation(&mut ft, issuance_details.asset_id, 1);

    signer.broadcast(&ft)?.wait()?;

    Ok(issuance_factory)
}

pub(super) fn fund_lender(
    context: &simplex::TestContext,
    lender: &Signer,
    principal_asset_id: AssetId,
    principal_to_send: u64,
) -> anyhow::Result<()> {
    let signer = context.get_default_signer();

    let principal_utxo = signer.get_utxos_asset(principal_asset_id)?[0].clone();
    let policy_utxo = signer.get_utxos_asset(context.get_network().policy_asset())?[0].clone();

    let principal_utxo_amount = principal_utxo.explicit_amount();
    let policy_amount_to_send = policy_utxo.explicit_amount() / 2;

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(principal_utxo),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_input(
        PartialInput::new(policy_utxo),
        RequiredSignature::NativeEcdsa,
    );

    ft.add_output(PartialOutput::new(
        lender.get_address().script_pubkey(),
        principal_to_send,
        principal_asset_id,
    ));
    ft.add_output(PartialOutput::new(
        lender.get_address().script_pubkey(),
        policy_amount_to_send,
        context.get_network().policy_asset(),
    ));

    if principal_utxo_amount > principal_to_send {
        ft.add_output(PartialOutput::new(
            signer.get_address().script_pubkey(),
            principal_utxo_amount - principal_to_send,
            principal_asset_id,
        ));
    }

    signer.broadcast(&ft)?.wait()?;

    Ok(())
}

pub(super) fn make_confidential(signer: &Signer, asset_utxo: UTXO) -> anyhow::Result<()> {
    let mut ft = FinalTransaction::new();

    ft.add_output(
        PartialOutput::new(
            signer.get_confidential_address().script_pubkey(),
            asset_utxo.explicit_amount(),
            asset_utxo.explicit_asset(),
        )
        .with_blinding_key(signer.get_blinding_public_key()),
    );
    ft.add_input(
        PartialInput::new(asset_utxo),
        RequiredSignature::NativeEcdsa,
    );

    signer.broadcast(&ft)?.wait()?;

    Ok(())
}

pub(super) fn setup_pending_offer(
    context: &simplex::TestContext,
    offer_parameters: OfferParameters,
    factory: IssuanceFactory,
    total_principal_amount: u64,
) -> anyhow::Result<(Txid, LendingOffer, LendingOfferParameters)> {
    let provider = context.get_default_provider();
    let signer = context.get_default_signer();

    let protocol_fee_keeper_asset_id = issue_asset(context, 1)?;
    let principal_asset_id = issue_asset(context, total_principal_amount)?;

    let collateral_asset_id = context.get_network().policy_asset();

    let collateral_utxo = signer.get_utxos_filter(
        &|utxo| {
            utxo.explicit_asset() == collateral_asset_id
                && utxo.explicit_amount() >= offer_parameters.collateral_amount
        },
        &|_| true,
    )?[0]
        .clone();

    let issuance_factory_utxo =
        provider.fetch_scripthash_utxos(&factory.get_script_pubkey())?[0].clone();
    let issuance_factory_asset_id = issuance_factory_utxo.explicit_asset();

    let factory_auth_nft_utxo = signer.get_utxos_asset(issuance_factory_asset_id)?[0].clone();

    // TODO: Use hash from the offer_parameters as asset_entropy
    let nfts_entropy = get_random_seed();

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(factory_auth_nft_utxo),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        1,
        issuance_factory_asset_id,
    ));

    let borrower_nft_issuance_details = factory.attach_assets_issuance(
        &mut ft,
        issuance_factory_utxo,
        IssuanceInput::new_issuance(1, 0, nfts_entropy),
    );
    let lender_nft_issuance_details = ft.add_issuance_input(
        PartialInput::new(collateral_utxo),
        IssuanceInput::new_issuance(1, 0, nfts_entropy),
        RequiredSignature::NativeEcdsa,
    );

    let lending_offer_parameters = LendingOfferParameters {
        collateral_asset_id,
        principal_asset_id,
        borrower_nft_asset_id: borrower_nft_issuance_details.asset_id,
        lender_nft_asset_id: lender_nft_issuance_details.asset_id,
        protocol_fee_keeper_asset_id,
        offer_parameters,
        network: *context.get_network(),
    };

    ft.add_output(PartialOutput::new(
        signer.get_address().script_pubkey(),
        1,
        borrower_nft_issuance_details.asset_id,
    ));

    let pending_offer = LendingOffer::new_pending(lending_offer_parameters);

    pending_offer.attach_creation(&mut ft);

    let receipt = signer.broadcast(&ft)?;

    receipt.wait()?;

    let pending_offer_parameters = *pending_offer.get_parameters();

    Ok((receipt.txid(), pending_offer, pending_offer_parameters))
}

pub(super) fn accept_pending_offer(
    context: &simplex::TestContext,
    pending_offer: &mut LendingOffer,
    pending_offer_creation_txid: Txid,
    lender: &Signer,
) -> anyhow::Result<Txid> {
    let pending_offer_parameters = *pending_offer.get_parameters();

    let (pending_offer_utxo, lender_nft_utxo) =
        get_pending_offer_utxos(context, pending_offer, pending_offer_creation_txid)?;

    let mut ft = FinalTransaction::new();

    pending_offer.attach_acceptance(&mut ft, pending_offer_utxo, lender_nft_utxo);

    let lender_principal_utxo = lender.get_utxos_filter(
        &|utxo| {
            utxo.explicit_asset() == pending_offer_parameters.principal_asset_id
                && utxo.explicit_amount()
                    >= pending_offer_parameters.offer_parameters.principal_amount
        },
        &|_| true,
    )?[0]
        .clone();

    let principal_utxo_amount = lender_principal_utxo.explicit_amount();

    ft.add_input(
        PartialInput::new(lender_principal_utxo),
        RequiredSignature::NativeEcdsa,
    );

    ft.add_output(PartialOutput::new(
        lender.get_address().script_pubkey(),
        1,
        pending_offer_parameters.lender_nft_asset_id,
    ));

    if principal_utxo_amount > pending_offer_parameters.offer_parameters.principal_amount {
        ft.add_output(PartialOutput::new(
            lender.get_address().script_pubkey(),
            principal_utxo_amount - pending_offer_parameters.offer_parameters.principal_amount,
            pending_offer_parameters.principal_asset_id,
        ));
    }

    let receipt = lender.broadcast(&ft)?;

    receipt.wait()?;

    Ok(receipt.txid())
}

pub(super) fn partial_repay_offer(
    context: &simplex::TestContext,
    active_offer: &mut LendingOffer,
    borrower: &Signer,
    amount_to_repay: u64,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();

    let active_offer_parameters = *active_offer.get_parameters();

    let active_offer_utxo =
        provider.fetch_scripthash_utxos(&active_offer.get_script_pubkey())?[0].clone();
    let borrower_nft_utxo =
        borrower.get_utxos_asset(active_offer_parameters.borrower_nft_asset_id)?[0].clone();
    let (lender_vault_utxo, protocol_fee_vault_utxo) =
        get_active_offer_vaults_utxos(context, active_offer_parameters)?;

    let borrower_principal_utxo =
        borrower.get_utxos_asset(active_offer_parameters.principal_asset_id)?[0].clone();

    let principal_utxo_amount = borrower_principal_utxo.explicit_amount();

    assert!(principal_utxo_amount >= amount_to_repay);

    let mut ft = FinalTransaction::new();

    ft.add_input(
        PartialInput::new(borrower_nft_utxo),
        RequiredSignature::NativeEcdsa,
    );
    ft.add_output(PartialOutput::new(
        borrower.get_address().script_pubkey(),
        1,
        active_offer_parameters.borrower_nft_asset_id,
    ));

    active_offer.attach_partial_repayment(
        &mut ft,
        active_offer_utxo,
        lender_vault_utxo,
        protocol_fee_vault_utxo,
        amount_to_repay,
    );

    ft.add_input(
        PartialInput::new(borrower_principal_utxo),
        RequiredSignature::NativeEcdsa,
    );

    if active_offer.get_current_debt() == amount_to_repay {
        ft.add_output(PartialOutput::new(
            borrower.get_address().script_pubkey(),
            active_offer_parameters.offer_parameters.collateral_amount,
            active_offer_parameters.collateral_asset_id,
        ));
    }

    if principal_utxo_amount > amount_to_repay {
        ft.add_output(PartialOutput::new(
            borrower.get_address().script_pubkey(),
            principal_utxo_amount - amount_to_repay,
            active_offer_parameters.principal_asset_id,
        ));
    }

    borrower.broadcast(&ft)?.wait()?;

    Ok(())
}

pub(super) fn get_pending_offer_utxos(
    context: &simplex::TestContext,
    pending_offer: &LendingOffer,
    pending_offer_creation_txid: Txid,
) -> anyhow::Result<(UTXO, UTXO)> {
    let provider = context.get_default_provider();

    let pending_offer_utxo =
        provider.fetch_scripthash_utxos(&pending_offer.get_script_pubkey())?[0].clone();

    let pending_offer_creation_tx = provider.fetch_transaction(&pending_offer_creation_txid)?;

    let lender_nft_utxo = UTXO {
        outpoint: OutPoint::new(pending_offer_creation_txid, 3),
        txout: pending_offer_creation_tx.output[3].clone(),
        secrets: None,
    };

    Ok((pending_offer_utxo, lender_nft_utxo))
}

pub(super) fn get_active_offer_utxos(
    context: &simplex::TestContext,
    active_offer: &LendingOffer,
    active_offer_creation_txid: Txid,
) -> anyhow::Result<(UTXO, UTXO)> {
    let provider = context.get_default_provider();

    let active_offer_utxo =
        provider.fetch_scripthash_utxos(&active_offer.get_script_pubkey())?[0].clone();

    let active_offer_creation_tx = provider.fetch_transaction(&active_offer_creation_txid)?;

    let lender_nft_utxo = UTXO {
        outpoint: OutPoint::new(active_offer_creation_txid, 2),
        txout: active_offer_creation_tx.output[2].clone(),
        secrets: None,
    };

    Ok((active_offer_utxo, lender_nft_utxo))
}

pub(super) fn get_lender_vault_utxo(
    context: &simplex::TestContext,
    offer: &LendingOffer,
) -> anyhow::Result<UTXO> {
    let provider = context.get_default_provider();
    let offer_parameters = offer.get_parameters();

    let lender_vault_utxo = if offer.get_current_debt() > 0 {
        provider.fetch_scripthash_utxos(
            &offer_parameters
                .get_active_lender_vault()
                .get_script_pubkey(),
        )?[0]
            .clone()
    } else {
        provider.fetch_scripthash_utxos(
            &offer_parameters
                .get_finalized_lender_vault()
                .get_script_pubkey(),
        )?[0]
            .clone()
    };

    Ok(lender_vault_utxo)
}

pub(super) fn get_protocol_fee_vault_utxo(
    context: &simplex::TestContext,
    offer: &LendingOffer,
) -> anyhow::Result<UTXO> {
    let provider = context.get_default_provider();
    let offer_parameters = offer.get_parameters();

    let total_amount_to_repay = offer_parameters
        .offer_parameters
        .get_total_amount_to_repay();
    let total_fee_to_repay = offer_parameters.offer_parameters.get_total_fee();

    let protocol_fee_vault_utxo =
        if offer.get_current_debt() >= total_amount_to_repay - total_fee_to_repay {
            provider.fetch_scripthash_utxos(
                &offer_parameters
                    .get_active_protocol_fee_vault()
                    .get_script_pubkey(),
            )?[0]
                .clone()
        } else {
            provider.fetch_scripthash_utxos(
                &offer_parameters
                    .get_finalized_protocol_fee_vault()
                    .get_script_pubkey(),
            )?[0]
                .clone()
        };

    Ok(protocol_fee_vault_utxo)
}

pub(super) fn get_active_offer_vaults_utxos(
    context: &simplex::TestContext,
    offer_parameters: LendingOfferParameters,
) -> anyhow::Result<(Option<UTXO>, Option<UTXO>)> {
    let provider = context.get_default_provider();

    let active_lender_vault = offer_parameters.get_active_lender_vault();
    let active_protocol_fee_vault = offer_parameters.get_active_protocol_fee_vault();

    let lender_vault_utxo = provider
        .fetch_scripthash_utxos(&active_lender_vault.get_script_pubkey())?
        .first()
        .cloned();
    let protocol_fee_vault_utxo = provider
        .fetch_scripthash_utxos(&active_protocol_fee_vault.get_script_pubkey())?
        .first()
        .cloned();

    Ok((lender_vault_utxo, protocol_fee_vault_utxo))
}
