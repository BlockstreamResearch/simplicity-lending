use anyhow::Context;
use lending_contracts::programs::asset_auth_vault::AssetAuthVault;
use lending_contracts::programs::lending::LendingOffer;
use lending_contracts::programs::program::SimplexProgram;
use lending_indexer::indexer::TrackerRegistry;
use lending_indexer::models::{OfferModel, OfferStatus, OfferVaultModel, UtxoType, VaultType};
use simplex::{
    provider::SimplicityNetwork,
    simplicityhl::elements::{
        AssetId, OutPoint, Script, Transaction, TxOut, Txid, confidential, hashes::Hash,
    },
};
use sqlx::PgPool;
use uuid::Uuid;

use super::{
    factory_model, outpoint_from_offer_id, seed_factory_row, seed_offer_row, seed_offer_utxo_row,
    tx_with_inputs, unique_32_bytes_from_uuid, unspent_offer_utxo,
};

pub const TRACKABLE_REPAYMENT_HEIGHT: u64 = 200;
pub const FIRST_PARTIAL_AMOUNT: u64 = 500;
pub const SECOND_PARTIAL_AMOUNT: u64 = 200;

/// Offer parameters large enough to produce non-zero protocol fees and meaningful vault splits.
pub fn trackable_offer_model(
    txid_seed: i64,
    issuance_factory_id: Uuid,
    created_at_height: i64,
) -> OfferModel {
    let total_debt = 11_000_i64;
    OfferModel {
        id: 0,
        issuance_factory_id,
        collateral_asset_id: vec![1; 32],
        principal_asset_id: vec![2; 32],
        borrower_nft_asset_id: vec![7; 32],
        lender_nft_asset_id: vec![8; 32],
        protocol_fee_keeper_asset_id: vec![5; 32],
        collateral_amount: 3_000,
        principal_amount: 10_000,
        current_debt: total_debt,
        collateral_remaining: 3_000,
        interest_rate: 1_000,
        loan_expiration_time: 1_234_567,
        current_status: OfferStatus::Active,
        updated_at_height: created_at_height,
        created_at_height,
        created_at_txid: super::unique_32_bytes_from_i64(txid_seed),
    }
}

pub async fn seed_minimal_factory(pool: &PgPool) -> anyhow::Result<Uuid> {
    let factory_id = Uuid::new_v4();
    let factory = factory_model(factory_id, 100, unique_32_bytes_from_uuid(factory_id));
    seed_factory_row(pool, &factory).await?;
    Ok(factory_id)
}

pub async fn seed_trackable_active_offer(
    pool: &PgPool,
    factory_id: Uuid,
    txid_seed: i64,
    created_at_height: i64,
) -> anyhow::Result<(i64, OutPoint, OfferModel)> {
    let mut offer = trackable_offer_model(txid_seed, factory_id, created_at_height);
    let offer_id = seed_offer_row(pool, &mut offer).await?;
    let active_outpoint = outpoint_from_offer_id(txid_seed, 0);
    seed_offer_utxo_row(
        pool,
        &unspent_offer_utxo(
            offer_id,
            active_outpoint,
            UtxoType::ActiveOffer,
            created_at_height,
        ),
    )
    .await?;

    Ok((offer_id, active_outpoint, offer))
}

pub async fn load_registry(pool: &PgPool) -> anyhow::Result<TrackerRegistry> {
    let protocol_fee_keeper_asset_id =
        AssetId::from_slice(&[5_u8; 32]).context("protocol fee keeper asset id")?;
    TrackerRegistry::load(
        pool,
        protocol_fee_keeper_asset_id,
        SimplicityNetwork::LiquidTestnet,
        None,
    )
    .await
}

pub async fn process_tx_through_registry(
    pool: &PgPool,
    registry: &mut TrackerRegistry,
    tx: &Transaction,
    block_height: u64,
) -> anyhow::Result<()> {
    let mut sql_tx = pool.begin().await?;
    registry.begin_block();
    registry
        .process_tx(&mut sql_tx, tx, block_height)
        .await
        .context("process_tx")?;
    registry.commit_block();
    sql_tx.commit().await?;
    Ok(())
}

pub async fn fetch_offer_status(pool: &PgPool, offer_id: i64) -> anyhow::Result<OfferStatus> {
    let status = sqlx::query_scalar!(
        r#"SELECT current_status AS "status: OfferStatus" FROM offers WHERE id = $1"#,
        offer_id
    )
    .fetch_one(pool)
    .await?;
    Ok(status)
}

pub async fn fetch_active_vault_rows(
    pool: &PgPool,
    offer_id: i64,
) -> anyhow::Result<Vec<OfferVaultModel>> {
    let rows = sqlx::query_as!(
        OfferVaultModel,
        r#"
        SELECT
            id,
            offer_id,
            vault_type AS "vault_type: VaultType",
            txid,
            vout,
            amount,
            already_supplied,
            is_finalized,
            created_at_height,
            updated_at_height,
            spent_txid,
            spent_at_height
        FROM offer_vaults
        WHERE offer_id = $1
          AND spent_txid IS NULL
        ORDER BY vault_type ASC
        "#,
        offer_id
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn count_unspent_utxos_of_type(
    pool: &PgPool,
    offer_id: i64,
    utxo_type: UtxoType,
) -> anyhow::Result<i64> {
    let count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*)::BIGINT
        FROM offer_utxos
        WHERE offer_id = $1
          AND utxo_type = $2
          AND spent_txid IS NULL
        "#,
        offer_id,
        utxo_type as UtxoType
    )
    .fetch_one(pool)
    .await?
    .unwrap_or(0);
    Ok(count)
}

pub fn offer_lending_params(
    offer: &OfferModel,
) -> anyhow::Result<lending_contracts::programs::lending::LendingOfferParameters> {
    offer.to_lending_offer_parameters(SimplicityNetwork::LiquidTestnet)
}

pub fn build_full_repayment_tx(
    active_input: OutPoint,
    offer: &OfferModel,
) -> anyhow::Result<Transaction> {
    let params = offer_lending_params(offer)?;
    let total = params.offer_parameters.get_total_amount_to_repay();
    let active = LendingOffer::new_active(params, total);
    let _ = active;

    let protocol_fee = params.offer_parameters.get_total_protocol_fee();
    let lender_amount = total - protocol_fee;
    let lender_vault = AssetAuthVault::new_finalized(params.get_lender_vault_parameters());
    let protocol_vault = AssetAuthVault::new_finalized(params.get_protocol_fee_vault_parameters());

    Ok(tx_with_inputs(
        vec![active_input],
        vec![
            op_return_asset(params.borrower_nft_asset_id),
            explicit_output(
                params.principal_asset_id,
                lender_amount,
                lender_vault.get_script_pubkey(),
            ),
            explicit_output(
                params.principal_asset_id,
                protocol_fee,
                protocol_vault.get_script_pubkey(),
            ),
            explicit_output(params.collateral_asset_id, 10, script(&[0x99])),
        ],
    ))
}

pub fn build_first_partial_repayment_tx(
    active_input: OutPoint,
    offer: &OfferModel,
    amount_to_repay: u64,
) -> anyhow::Result<(Transaction, u64)> {
    let params = offer_lending_params(offer)?;
    let debt_before = params.offer_parameters.get_total_amount_to_repay();
    let debt_after = debt_before - amount_to_repay;
    let _active = LendingOffer::new_active(params, debt_before);
    let continuing = LendingOffer::new_active(params, debt_after);

    let protocol_fee = params
        .offer_parameters
        .get_repaid_protocol_fee(debt_before, amount_to_repay);
    let lender_amount = amount_to_repay - protocol_fee;
    let lender_vault =
        AssetAuthVault::new_active(params.get_lender_vault_parameters(), lender_amount);
    let protocol_vault =
        AssetAuthVault::new_active(params.get_protocol_fee_vault_parameters(), protocol_fee);

    let collateral_before = offer.collateral_remaining as u64;
    let collateral_unlocked = params
        .offer_parameters
        .get_collateral_for_principal(amount_to_repay);
    let collateral_after = collateral_before - collateral_unlocked;

    let tx = tx_with_inputs(
        vec![active_input],
        vec![
            explicit_output(params.borrower_nft_asset_id, 1, script(&[0x51])),
            explicit_output(
                params.collateral_asset_id,
                collateral_after,
                continuing.get_script_pubkey(),
            ),
            explicit_output(
                params.principal_asset_id,
                lender_amount,
                lender_vault.get_script_pubkey(),
            ),
            explicit_output(
                params.principal_asset_id,
                protocol_fee,
                protocol_vault.get_script_pubkey(),
            ),
        ],
    );

    Ok((tx, debt_after))
}

pub fn build_second_partial_repayment_tx(
    active_input: OutPoint,
    lender_vault_input: OutPoint,
    protocol_vault_input: OutPoint,
    offer: &OfferModel,
    debt_before: u64,
    amount_to_repay: u64,
) -> anyhow::Result<Transaction> {
    let params = offer_lending_params(offer)?;
    let debt_after = debt_before - amount_to_repay;
    let active = LendingOffer::new_active(params, debt_before);
    let _ = active;
    let continuing = LendingOffer::new_active(params, debt_after);

    let protocol_fee = params
        .offer_parameters
        .get_repaid_protocol_fee(debt_before, amount_to_repay);
    let lender_delta = amount_to_repay - protocol_fee;

    let lender_before_vault = params.get_lender_vault(debt_before);
    let protocol_before_vault = params.get_protocol_fee_vault(debt_before);
    let lender_before = lender_before_vault.get_already_supplied_amount();
    let protocol_before = protocol_before_vault.get_already_supplied_amount();

    let lender_after_supplied = lender_before + lender_delta;
    let protocol_after_supplied = protocol_before + protocol_fee;
    let lender_after =
        AssetAuthVault::new_active(params.get_lender_vault_parameters(), lender_after_supplied);
    let protocol_after = AssetAuthVault::new_active(
        params.get_protocol_fee_vault_parameters(),
        protocol_after_supplied,
    );

    let collateral_before = offer.collateral_remaining as u64;
    let already_repaid = params
        .offer_parameters
        .get_already_repaid_amount(debt_before);
    let collateral_unlocked_total = params
        .offer_parameters
        .get_collateral_for_principal(already_repaid + amount_to_repay);
    let collateral_unlocked_before = params
        .offer_parameters
        .get_collateral_for_principal(already_repaid);
    let collateral_after =
        collateral_before - (collateral_unlocked_total - collateral_unlocked_before);

    Ok(tx_with_inputs(
        vec![lender_vault_input, protocol_vault_input, active_input],
        vec![
            explicit_output(params.borrower_nft_asset_id, 1, script(&[0x51])),
            explicit_output(
                params.collateral_asset_id,
                collateral_after,
                continuing.get_script_pubkey(),
            ),
            explicit_output(
                params.principal_asset_id,
                lender_before + lender_delta,
                lender_after.get_script_pubkey(),
            ),
            explicit_output(
                params.principal_asset_id,
                protocol_before + protocol_fee,
                protocol_after.get_script_pubkey(),
            ),
        ],
    ))
}

pub fn build_lender_vault_withdraw_all_tx(
    lender_vault_input: OutPoint,
    offer: &OfferModel,
    vault_amount: u64,
) -> anyhow::Result<Transaction> {
    let params = offer_lending_params(offer)?;
    Ok(tx_with_inputs(
        vec![lender_vault_input],
        vec![explicit_output(
            params.principal_asset_id,
            vault_amount,
            script(&[0x99]),
        )],
    ))
}

pub fn outpoint_from_txid_byte(txid_byte: u8, vout: u32) -> OutPoint {
    OutPoint {
        txid: Txid::from_slice(&[txid_byte; 32]).expect("valid txid"),
        vout,
    }
}

pub async fn seed_offer_vault_row(pool: &PgPool, vault: &OfferVaultModel) -> anyhow::Result<()> {
    let mut sql_tx = pool.begin().await?;
    lending_indexer::indexer::insert_offer_vault(&mut sql_tx, vault).await?;
    sql_tx.commit().await?;
    Ok(())
}

pub fn repaid_offer_model(
    txid_seed: i64,
    issuance_factory_id: Uuid,
    created_at_height: i64,
) -> OfferModel {
    let mut offer = trackable_offer_model(txid_seed, issuance_factory_id, created_at_height);
    offer.current_status = OfferStatus::Repaid;
    offer.current_debt = 0;
    offer.collateral_remaining = 0;
    offer
}

fn script(bytes: &[u8]) -> Script {
    Script::from(bytes.to_vec())
}

fn explicit_output(asset_id: AssetId, amount: u64, script_pubkey: Script) -> TxOut {
    let mut output = TxOut {
        script_pubkey,
        ..Default::default()
    };
    output.asset = confidential::Asset::Explicit(asset_id);
    output.value = confidential::Value::Explicit(amount);
    output
}

fn op_return_asset(asset_id: AssetId) -> TxOut {
    let mut output = TxOut {
        script_pubkey: Script::new_op_return(b"burn"),
        ..Default::default()
    };
    output.asset = confidential::Asset::Explicit(asset_id);
    output.value = confidential::Value::Explicit(1);
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trackable_offer_total_debt_matches_contract_math() {
        let offer = trackable_offer_model(1, Uuid::new_v4(), 100);
        let params = offer_lending_params(&offer).expect("params");
        assert_eq!(
            params.offer_parameters.get_total_amount_to_repay(),
            offer.current_debt as u64
        );
        assert!(params.offer_parameters.get_total_protocol_fee() > 0);
    }
}
