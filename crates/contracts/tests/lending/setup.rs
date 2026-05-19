use lending_contracts::programs::script_auth::ScriptAuth;
use simplex::signer::Signer;
use simplex::simplicityhl::elements::{AssetId, OutPoint, Txid};
use simplex::transaction::partial_input::IssuanceInput;
use simplex::transaction::{
    FinalTransaction, PartialInput, PartialOutput, RequiredSignature, UTXO,
};

use lending_contracts::programs::issuance_factory::{IssuanceFactory, IssuanceFactoryParameters};
use lending_contracts::programs::lending::{
    ActiveLendingOffer, ActiveLendingOfferParameters, OfferParameters, PendingLendingOffer,
    PendingLendingOfferParameters,
};
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
        owner_pubkey: signer.get_schnorr_public_key(),
        network: *context.get_network(),
    };
    let issuance_factory = IssuanceFactory::new(issuance_factory_parameters);

    let mut ft = FinalTransaction::new();

    let issuance_factory_entropy = get_random_seed();
    let issuance_factory_asset_amount = 1;

    let issuance_details = ft.add_issuance_input(
        PartialInput::new(signer_policy_utxo),
        IssuanceInput::new_issuance(issuance_factory_asset_amount, 0, issuance_factory_entropy),
        RequiredSignature::NativeEcdsa,
    );

    issuance_factory.attach_creation(
        &mut ft,
        issuance_details.asset_id,
        issuance_factory_asset_amount,
    );

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

pub(super) fn setup_pending_lending_offer(
    context: &simplex::TestContext,
    offer_parameters: OfferParameters,
    factory: IssuanceFactory,
    total_principal_amount: u64,
) -> anyhow::Result<(Txid, PendingLendingOffer, PendingLendingOfferParameters)> {
    let signer = context.get_default_signer();

    let (mut ft, active_lending_offer_parameters) =
        base_lending_offer_setup(context, offer_parameters, factory, total_principal_amount)?;

    let pending_lending_offer =
        PendingLendingOffer::from_active_lending(active_lending_offer_parameters);

    pending_lending_offer.attach_creation(&mut ft);

    let receipt = signer.broadcast(&ft)?;

    receipt.wait()?;

    let pending_offer_parameters = *pending_lending_offer.get_parameters();

    Ok((
        receipt.txid(),
        pending_lending_offer,
        pending_offer_parameters,
    ))
}

pub(super) fn setup_active_lending_offer(
    context: &simplex::TestContext,
    offer_parameters: OfferParameters,
    factory: IssuanceFactory,
    total_principal_amount: u64,
) -> anyhow::Result<(Txid, ActiveLendingOffer, ActiveLendingOfferParameters)> {
    let signer = context.get_default_signer();

    let (mut ft, active_lending_offer_parameters) =
        base_lending_offer_setup(context, offer_parameters, factory, total_principal_amount)?;

    let active_lending_offer = ActiveLendingOffer::new(active_lending_offer_parameters);

    let nfts_script_auth = ScriptAuth::from_simplex_program(&active_lending_offer);

    nfts_script_auth.attach_creation(
        &mut ft,
        active_lending_offer_parameters.borrower_debt_nft_asset_id,
        active_lending_offer_parameters
            .offer_parameters
            .get_total_amount_to_repay(),
    );
    nfts_script_auth.attach_creation(
        &mut ft,
        active_lending_offer_parameters.lender_nft_asset_id,
        1,
    );

    active_lending_offer.attach_creation(&mut ft);

    let receipt = signer.broadcast(&ft)?;

    receipt.wait()?;

    Ok((
        receipt.txid(),
        active_lending_offer,
        active_lending_offer_parameters,
    ))
}

pub(super) fn accept_pending_lending_offer(
    context: &simplex::TestContext,
    pending_lending_offer: PendingLendingOffer,
    pending_offer_creation_txid: Txid,
    lender: &Signer,
) -> anyhow::Result<(Txid, ActiveLendingOffer)> {
    let pending_offer_parameters = *pending_lending_offer.get_parameters();

    let (pending_offer_utxo, borrower_debt_nft_utxo, lender_nft_utxo) =
        get_pending_offer_utxos(context, &pending_lending_offer, pending_offer_creation_txid)?;

    let mut ft = FinalTransaction::new();

    let active_lending_offer = pending_lending_offer.attach_offer_acceptance(
        &mut ft,
        pending_offer_utxo,
        borrower_debt_nft_utxo,
        lender_nft_utxo,
    );

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

    Ok((receipt.txid(), active_lending_offer))
}

pub(super) fn partial_repay_offer(
    context: &simplex::TestContext,
    active_lending_offer: &ActiveLendingOffer,
    borrower: &Signer,
    amount_to_repay: u64,
) -> anyhow::Result<()> {
    let provider = context.get_default_provider();

    let active_offer_parameters = *active_lending_offer.get_parameters();

    let active_offer_utxo =
        provider.fetch_scripthash_utxos(&active_lending_offer.get_script_pubkey())?[0].clone();
    let borrower_debt_nft_utxo = get_borrower_debt_nft_utxo(&context, active_offer_parameters)?;
    let (lender_vault_utxo, protocol_fee_vault_utxo) =
        get_offer_vaults_utxos(context, active_offer_parameters)?;

    let borrower_principal_utxo =
        borrower.get_utxos_asset(active_offer_parameters.principal_asset_id)?[0].clone();

    let current_debt = borrower_debt_nft_utxo.explicit_amount();
    let principal_utxo_amount = borrower_principal_utxo.explicit_amount();

    assert!(principal_utxo_amount >= amount_to_repay);

    let mut ft = FinalTransaction::new();

    active_lending_offer.attach_partial_repayment(
        &mut ft,
        active_offer_utxo,
        borrower_debt_nft_utxo,
        lender_vault_utxo,
        protocol_fee_vault_utxo,
        amount_to_repay,
    );

    ft.add_input(
        PartialInput::new(borrower_principal_utxo),
        RequiredSignature::NativeEcdsa,
    );

    if current_debt == amount_to_repay {
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
    pending_lending_offer: &PendingLendingOffer,
    pending_offer_creation_txid: Txid,
) -> anyhow::Result<(UTXO, UTXO, UTXO)> {
    let provider = context.get_default_provider();

    let pending_offer_utxo =
        provider.fetch_scripthash_utxos(&pending_lending_offer.get_script_pubkey())?[0].clone();

    let pending_offer_creation_tx = provider.fetch_transaction(&pending_offer_creation_txid)?;

    let borrower_debt_nft_utxo = UTXO {
        outpoint: OutPoint::new(pending_offer_creation_txid, 1),
        txout: pending_offer_creation_tx.output[1].clone(),
        secrets: None,
    };
    let lender_nft_utxo = UTXO {
        outpoint: OutPoint::new(pending_offer_creation_txid, 2),
        txout: pending_offer_creation_tx.output[2].clone(),
        secrets: None,
    };

    Ok((pending_offer_utxo, borrower_debt_nft_utxo, lender_nft_utxo))
}

pub(super) fn get_active_offer_utxos(
    context: &simplex::TestContext,
    active_lending_offer: &ActiveLendingOffer,
    active_offer_creation_txid: Txid,
) -> anyhow::Result<(UTXO, UTXO, UTXO)> {
    let provider = context.get_default_provider();

    let active_offer_utxo =
        provider.fetch_scripthash_utxos(&active_lending_offer.get_script_pubkey())?[0].clone();

    let active_offer_creation_tx = provider.fetch_transaction(&active_offer_creation_txid)?;

    let borrower_debt_nft_utxo = UTXO {
        outpoint: OutPoint::new(active_offer_creation_txid, 1),
        txout: active_offer_creation_tx.output[1].clone(),
        secrets: None,
    };
    let lender_nft_utxo = UTXO {
        outpoint: OutPoint::new(active_offer_creation_txid, 3),
        txout: active_offer_creation_tx.output[2].clone(),
        secrets: None,
    };

    Ok((active_offer_utxo, borrower_debt_nft_utxo, lender_nft_utxo))
}

pub(super) fn get_borrower_debt_nft_utxo(
    context: &simplex::TestContext,
    active_offer_parameters: ActiveLendingOfferParameters,
) -> anyhow::Result<UTXO> {
    let debt_nft_script_auth = PendingLendingOfferParameters::from(active_offer_parameters)
        .get_borrower_debt_nft_script_auth();

    Ok(context
        .get_default_provider()
        .fetch_scripthash_utxos(&debt_nft_script_auth.get_script_pubkey())?[0]
        .clone())
}

pub(super) fn get_offer_vaults_utxos(
    context: &simplex::TestContext,
    active_offer_parameters: ActiveLendingOfferParameters,
) -> anyhow::Result<(Option<UTXO>, Option<UTXO>)> {
    let provider = context.get_default_provider();

    let active_lender_vault = active_offer_parameters.get_active_lender_vault();
    let active_protocol_fee_vault = active_offer_parameters.get_active_protocol_fee_vault();

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

fn base_lending_offer_setup(
    context: &simplex::TestContext,
    offer_parameters: OfferParameters,
    factory: IssuanceFactory,
    total_principal_amount: u64,
) -> anyhow::Result<(FinalTransaction, ActiveLendingOfferParameters)> {
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

    // TODO: Use hash from the offer_parameters as asset_entropy
    let nfts_entropy = get_random_seed();
    let total_amount_to_repay = offer_parameters.get_total_amount_to_repay();

    let mut ft = FinalTransaction::new();

    let borrower_debt_nft_issuance_details = factory.attach_assets_issuing(
        &mut ft,
        issuance_factory_utxo,
        IssuanceInput::new_issuance(total_amount_to_repay, 0, nfts_entropy),
    );
    let lender_nft_issuance_details = ft.add_issuance_input(
        PartialInput::new(collateral_utxo),
        IssuanceInput::new_issuance(1, 0, nfts_entropy),
        RequiredSignature::NativeEcdsa,
    );

    let active_lending_offer_parameters = ActiveLendingOfferParameters {
        collateral_asset_id,
        principal_asset_id,
        borrower_debt_nft_asset_id: borrower_debt_nft_issuance_details.asset_id,
        lender_nft_asset_id: lender_nft_issuance_details.asset_id,
        protocol_fee_keeper_asset_id,
        borrower_pubkey: signer.get_schnorr_public_key(),
        offer_parameters,
        network: *context.get_network(),
    };

    Ok((ft, active_lending_offer_parameters))
}
