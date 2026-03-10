use std::collections::HashMap;

use anyhow::{Context, Result, anyhow};
use lending_contracts::asset_auth::build_arguments::AssetAuthArguments;
use lending_contracts::asset_auth::build_witness::{
    AssetAuthWitnessParams, build_asset_auth_witness,
};
use lending_contracts::lending::{
    LENDING_SOURCE,
    build_witness::{LendingBranch, build_lending_witness},
};
use lending_contracts::pre_lock::PRE_LOCK_SOURCE;
use lending_contracts::script_auth::build_arguments::ScriptAuthArguments;
use lending_contracts::script_auth::build_witness::{
    ScriptAuthWitnessParams, build_script_auth_witness,
};
use lwk_simplicity::scripts::{create_p2tr_address, load_program};
use lwk_simplicity::wallet_abi::schema::{
    AssetVariant, BlinderVariant, FinalizerSpec, InputIssuance, InputIssuanceKind, InputSchema,
    InputUnblinding, InternalKeySource, LockVariant, OutputSchema, RuntimeSimfWitness,
    SimfArguments, SimfWitness, UTXOSource, serialize_arguments, serialize_witness,
};
use lwk_simplicity::wallet_abi::test_utils::{RuntimeFundingAsset, fund_address};
use lwk_wollet::elements as el26;
use lwk_wollet::secp256k1 as secp26;
use simplicityhl::elements as el25;
use simplicityhl::num::U256;
use simplicityhl::parse::ParseFromStr;
use simplicityhl::str::WitnessName;
use simplicityhl::types::TypeConstructible;
use simplicityhl::value::UIntValue;
use simplicityhl::value::ValueConstructible;
use simplicityhl::{Arguments, ResolvedType, Value, WitnessValues};
use simplicityhl_core::hash_script;

use crate::wallet_abi_common::{
    KnownUtxo, WalletAbiHarness, known_from_tx_output, txout25_to26, wallet_transfer_request,
};

const TOKENS_DECIMALS: u8 = 0;
const DEFAULT_COLLATERAL_AMOUNT: u64 = 25_000;
const DEFAULT_PRINCIPAL_AMOUNT: u64 = 10_000;
const DEFAULT_INTEREST_BPS: u16 = 500;
const FEE_FUNDING_AMOUNT: u64 = 1_000_000;
const INITIAL_LBTC_RESERVE_AMOUNT: u64 = 20_000_000;
const DEFAULT_EXPIRY_OFFSET: u32 = 64;
const LIQUIDATION_EXPIRY_OFFSET: u32 = 20;
const UTILITY_ISSUANCE_INPUT_VALUE: u64 = 100;
const UTILITY_ISSUANCE_ENTROPY: [u8; 32] = [7u8; 32];
const MAX_BASIS_POINTS: u64 = 10_000;
const POWERS_OF_10: [u64; 16] = [
    1,
    10,
    100,
    1_000,
    10_000,
    100_000,
    1_000_000,
    10_000_000,
    100_000_000,
    1_000_000_000,
    10_000_000_000,
    100_000_000_000,
    1_000_000_000_000,
    10_000_000_000_000,
    100_000_000_000_000,
    1_000_000_000_000_000,
];

#[derive(Clone, Debug)]
pub struct PreparedUtilityNfts {
    pub issuance_utxos: [KnownUtxo; 4],
}

#[derive(Clone, Debug)]
pub struct IssuedUtilityNfts {
    pub borrower_nft: KnownUtxo,
    pub lender_nft: KnownUtxo,
    pub first_parameters_nft: KnownUtxo,
    pub second_parameters_nft: KnownUtxo,
}

#[derive(Clone, Debug)]
pub struct PreLockState {
    pub arguments: PreLockContractArgs,
    pub utility_script_auth_arguments: ScriptAuthArguments,
    pub pre_lock: KnownUtxo,
    pub first_parameters_nft: KnownUtxo,
    pub second_parameters_nft: KnownUtxo,
    pub borrower_nft: KnownUtxo,
    pub lender_nft: KnownUtxo,
}

#[derive(Clone, Debug)]
pub struct LendingState {
    pub arguments: LendingContractArgs,
    pub parameters_script_auth_arguments: ScriptAuthArguments,
    pub lender_asset_auth_arguments: AssetAuthArguments,
    pub lending: KnownUtxo,
    pub first_parameters_nft: KnownUtxo,
    pub second_parameters_nft: KnownUtxo,
    pub borrower_nft: KnownUtxo,
    pub lender_nft: KnownUtxo,
    pub principal_borrowed: KnownUtxo,
}

#[derive(Clone, Debug)]
pub struct RepaymentState {
    pub asset_auth_arguments: AssetAuthArguments,
    pub asset_auth: KnownUtxo,
    pub collateral: KnownUtxo,
    pub lender_nft: KnownUtxo,
}

#[derive(Clone, Debug)]
pub struct ClaimState {
    pub principal_claim: KnownUtxo,
}

#[derive(Clone, Debug)]
pub struct LiquidationState {
    pub collateral: KnownUtxo,
}

#[derive(Debug, Clone, Copy)]
pub struct ProtocolTerms {
    pub collateral_amount: u64,
    pub principal_amount: u64,
    pub loan_expiration_time: u32,
    pub principal_interest_rate: u16,
}

impl ProtocolTerms {
    pub fn encode_parameters_nft_amounts(self, amounts_decimals: u8) -> Result<(u64, u64)> {
        let first = encode_first_parameters_nft(
            self.principal_interest_rate,
            self.loan_expiration_time,
            amounts_decimals,
            amounts_decimals,
        )?;
        let second = encode_second_parameters_nft(
            to_base_amount(self.collateral_amount, amounts_decimals),
            to_base_amount(self.principal_amount, amounts_decimals),
        )?;
        Ok((first, second))
    }

    pub fn principal_with_interest(self) -> u64 {
        calculate_principal_with_interest(self.principal_amount, self.principal_interest_rate)
    }
}

#[derive(Debug, Clone)]
pub struct PreLockContractArgs {
    collateral_asset_id: [u8; 32],
    principal_asset_id: [u8; 32],
    borrower_nft_asset_id: [u8; 32],
    lender_nft_asset_id: [u8; 32],
    first_parameters_nft_asset_id: [u8; 32],
    second_parameters_nft_asset_id: [u8; 32],
    lending_cov_hash: [u8; 32],
    parameters_nft_output_script_hash: [u8; 32],
    borrower_nft_output_script_hash: [u8; 32],
    principal_output_script_hash: [u8; 32],
    borrower_pub_key: [u8; 32],
    terms: ProtocolTerms,
}

impl PreLockContractArgs {
    #[allow(clippy::too_many_arguments)]
    const fn new(
        collateral_asset_id: [u8; 32],
        principal_asset_id: [u8; 32],
        borrower_nft_asset_id: [u8; 32],
        lender_nft_asset_id: [u8; 32],
        first_parameters_nft_asset_id: [u8; 32],
        second_parameters_nft_asset_id: [u8; 32],
        lending_cov_hash: [u8; 32],
        parameters_nft_output_script_hash: [u8; 32],
        borrower_nft_output_script_hash: [u8; 32],
        principal_output_script_hash: [u8; 32],
        borrower_pub_key: [u8; 32],
        terms: ProtocolTerms,
    ) -> Self {
        Self {
            collateral_asset_id,
            principal_asset_id,
            borrower_nft_asset_id,
            lender_nft_asset_id,
            first_parameters_nft_asset_id,
            second_parameters_nft_asset_id,
            lending_cov_hash,
            parameters_nft_output_script_hash,
            borrower_nft_output_script_hash,
            principal_output_script_hash,
            borrower_pub_key,
            terms,
        }
    }

    fn build_simf_arguments(&self) -> Arguments {
        Arguments::from(HashMap::from([
            argument_u256("COLLATERAL_ASSET_ID", self.collateral_asset_id),
            argument_u256("PRINCIPAL_ASSET_ID", self.principal_asset_id),
            argument_u256("BORROWER_NFT_ASSET_ID", self.borrower_nft_asset_id),
            argument_u256("LENDER_NFT_ASSET_ID", self.lender_nft_asset_id),
            argument_u256(
                "FIRST_PARAMETERS_NFT_ASSET_ID",
                self.first_parameters_nft_asset_id,
            ),
            argument_u256(
                "SECOND_PARAMETERS_NFT_ASSET_ID",
                self.second_parameters_nft_asset_id,
            ),
            argument_u256("LENDING_COV_HASH", self.lending_cov_hash),
            argument_u256(
                "PARAMETERS_NFT_OUTPUT_SCRIPT_HASH",
                self.parameters_nft_output_script_hash,
            ),
            argument_u256(
                "BORROWER_NFT_OUTPUT_SCRIPT_HASH",
                self.borrower_nft_output_script_hash,
            ),
            argument_u256(
                "PRINCIPAL_OUTPUT_SCRIPT_HASH",
                self.principal_output_script_hash,
            ),
            argument_u256("BORROWER_PUB_KEY", self.borrower_pub_key),
            argument_u64("COLLATERAL_AMOUNT", self.terms.collateral_amount),
            argument_u64("PRINCIPAL_AMOUNT", self.terms.principal_amount),
            argument_u32("LOAN_EXPIRATION_TIME", self.terms.loan_expiration_time),
            argument_u16(
                "PRINCIPAL_INTEREST_RATE",
                self.terms.principal_interest_rate,
            ),
        ]))
    }
}

#[derive(Debug, Clone)]
pub struct LendingContractArgs {
    collateral_asset_id: [u8; 32],
    principal_asset_id: [u8; 32],
    borrower_nft_asset_id: [u8; 32],
    lender_nft_asset_id: [u8; 32],
    first_parameters_nft_asset_id: [u8; 32],
    second_parameters_nft_asset_id: [u8; 32],
    lender_principal_cov_hash: [u8; 32],
    terms: ProtocolTerms,
}

impl LendingContractArgs {
    #[allow(clippy::too_many_arguments)]
    const fn new(
        collateral_asset_id: [u8; 32],
        principal_asset_id: [u8; 32],
        borrower_nft_asset_id: [u8; 32],
        lender_nft_asset_id: [u8; 32],
        first_parameters_nft_asset_id: [u8; 32],
        second_parameters_nft_asset_id: [u8; 32],
        lender_principal_cov_hash: [u8; 32],
        terms: ProtocolTerms,
    ) -> Self {
        Self {
            collateral_asset_id,
            principal_asset_id,
            borrower_nft_asset_id,
            lender_nft_asset_id,
            first_parameters_nft_asset_id,
            second_parameters_nft_asset_id,
            lender_principal_cov_hash,
            terms,
        }
    }

    fn build_simf_arguments(&self) -> Arguments {
        Arguments::from(HashMap::from([
            argument_u256("COLLATERAL_ASSET_ID", self.collateral_asset_id),
            argument_u256("PRINCIPAL_ASSET_ID", self.principal_asset_id),
            argument_u256("BORROWER_NFT_ASSET_ID", self.borrower_nft_asset_id),
            argument_u256("LENDER_NFT_ASSET_ID", self.lender_nft_asset_id),
            argument_u256(
                "FIRST_PARAMETERS_NFT_ASSET_ID",
                self.first_parameters_nft_asset_id,
            ),
            argument_u256(
                "SECOND_PARAMETERS_NFT_ASSET_ID",
                self.second_parameters_nft_asset_id,
            ),
            argument_u256("LENDER_PRINCIPAL_COV_HASH", self.lender_principal_cov_hash),
            argument_u64("COLLATERAL_AMOUNT", self.terms.collateral_amount),
            argument_u64("PRINCIPAL_AMOUNT", self.terms.principal_amount),
            argument_u32("LOAN_EXPIRATION_TIME", self.terms.loan_expiration_time),
            argument_u16(
                "PRINCIPAL_INTEREST_RATE",
                self.terms.principal_interest_rate,
            ),
        ]))
    }
}

impl WalletAbiHarness {
    fn signer_x_only_public_key_25(&self) -> Result<el25::schnorr::XOnlyPublicKey> {
        xonly26_to25(&self.signer_meta.signer_x_only_public_key()?)
    }

    fn signer_x_only_public_key_26(&self) -> Result<secp26::XOnlyPublicKey> {
        self.signer_meta
            .signer_x_only_public_key()
            .map_err(Into::into)
    }

    async fn fund_explicit_wallet_asset(
        &self,
        asset_id: el26::AssetId,
        amount: u64,
        output_id: &str,
    ) -> Result<KnownUtxo> {
        let tx = self
            .process_request(wallet_transfer_request(
                vec![],
                vec![OutputSchema {
                    id: output_id.into(),
                    amount_sat: amount,
                    lock: LockVariant::Script {
                        script: self.wallet_script_26().clone(),
                    },
                    asset: AssetVariant::AssetId { asset_id },
                    blinder: BlinderVariant::Explicit,
                }],
            ))
            .await?;

        self.find_output(&tx, |tx_out| {
            tx_out.script_pubkey == *self.wallet_script_25()
                && tx_out.asset.explicit() == Some(asset_id26_to25(asset_id).expect("asset"))
                && tx_out.value.explicit() == Some(amount)
        })
    }

    async fn current_tip_height(&self) -> Result<u32> {
        let response = minreq::get(format!(
            "{}/blocks/tip/height",
            lwk_simplicity::wallet_abi::test_utils::get_esplora_url()?
        ))
        .send()
        .context("failed to query esplora tip height")?;
        if response.status_code != 200 {
            anyhow::bail!(
                "unexpected esplora tip response status {}",
                response.status_code
            );
        }

        response
            .as_str()
            .context("failed to decode tip height body")?
            .trim()
            .parse::<u32>()
            .context("failed to parse tip height")
    }

    fn find_nth_output(
        &self,
        tx: &el25::Transaction,
        predicate: impl Fn(&el25::TxOut) -> bool,
        index: usize,
    ) -> Result<KnownUtxo> {
        let matches = tx
            .output
            .iter()
            .enumerate()
            .filter_map(|(vout, tx_out)| predicate(tx_out).then_some((vout, tx_out.clone())))
            .collect::<Vec<_>>();
        let (vout, tx_out) = matches
            .get(index)
            .cloned()
            .ok_or_else(|| anyhow!("matching output index {index} out of bounds"))?;
        let tx_out_26 = txout25_to26(&tx_out)?;
        known_from_tx_output(tx, vout, tx_out_26)
    }
}

pub struct LendingScenario {
    pub harness: WalletAbiHarness,
    pub terms: ProtocolTerms,
    pub policy_asset_id: el25::AssetId,
    pub collateral_asset_id: el25::AssetId,
    pub principal_asset_id: el25::AssetId,
    pub principal_lend_utxo: KnownUtxo,
    pub principal_repay_utxo: KnownUtxo,
}

impl LendingScenario {
    pub async fn new_default() -> Result<Self> {
        Self::new_with_expiry_offset(DEFAULT_EXPIRY_OFFSET).await
    }

    pub async fn new_for_liquidation() -> Result<Self> {
        Self::new_with_expiry_offset(LIQUIDATION_EXPIRY_OFFSET).await
    }

    async fn new_with_expiry_offset(expiry_offset: u32) -> Result<Self> {
        let harness = WalletAbiHarness::new().await?;
        let current_tip = harness.current_tip_height().await?;
        let terms = ProtocolTerms {
            collateral_amount: DEFAULT_COLLATERAL_AMOUNT,
            principal_amount: DEFAULT_PRINCIPAL_AMOUNT,
            loan_expiration_time: current_tip
                .checked_add(expiry_offset)
                .context("loan expiration height overflow")?,
            principal_interest_rate: DEFAULT_INTEREST_BPS,
        };

        let lbtc_funding = fund_address(
            &harness.signer_address,
            RuntimeFundingAsset::Lbtc,
            INITIAL_LBTC_RESERVE_AMOUNT,
        )?;
        let collateral_funding = fund_address(
            &harness.signer_address,
            RuntimeFundingAsset::IssuedAsset,
            terms.collateral_amount,
        )?;
        let principal_funding = fund_address(
            &harness.signer_address,
            RuntimeFundingAsset::IssuedAsset,
            terms
                .principal_amount
                .checked_add(terms.principal_with_interest())
                .context("principal funding amount overflow")?,
        )?;
        harness.mine_and_sync(1).await?;

        let policy_asset_id = asset_id26_to25(lbtc_funding.funded_asset_id)?;
        let collateral_asset_id = asset_id26_to25(collateral_funding.funded_asset_id)?;
        let principal_asset_id = asset_id26_to25(principal_funding.funded_asset_id)?;
        let split_tx = harness
            .process_request(wallet_transfer_request(
                vec![InputSchema {
                    id: "principal-funding".into(),
                    utxo_source: UTXOSource::default(),
                    unblinding: InputUnblinding::Wallet,
                    sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                    issuance: None,
                    finalizer: FinalizerSpec::Wallet,
                }],
                vec![
                    OutputSchema {
                        id: "principal-lend".into(),
                        amount_sat: terms.principal_amount,
                        lock: LockVariant::Script {
                            script: harness.wallet_script_26().clone(),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: principal_funding.funded_asset_id,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "principal-repay".into(),
                        amount_sat: terms.principal_with_interest(),
                        lock: LockVariant::Script {
                            script: harness.wallet_script_26().clone(),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: principal_funding.funded_asset_id,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                ],
            ))
            .await?;
        harness.mine_and_sync(1).await?;
        let principal_lend_utxo = harness.find_output(&split_tx, |tx_out| {
            tx_out.script_pubkey == *harness.wallet_script_25()
                && tx_out.asset.explicit() == Some(principal_asset_id)
                && tx_out.value.explicit() == Some(terms.principal_amount)
        })?;
        let principal_repay_utxo = harness.find_output(&split_tx, |tx_out| {
            tx_out.script_pubkey == *harness.wallet_script_25()
                && tx_out.asset.explicit() == Some(principal_asset_id)
                && tx_out.value.explicit() == Some(terms.principal_with_interest())
        })?;

        Ok(Self {
            harness,
            terms,
            policy_asset_id,
            collateral_asset_id,
            principal_asset_id,
            principal_lend_utxo,
            principal_repay_utxo,
        })
    }

    async fn fund_explicit_policy_fee(&self, output_id: &str) -> Result<KnownUtxo> {
        self.harness
            .fund_explicit_wallet_asset(
                asset_id25_to26(self.policy_asset_id)?,
                FEE_FUNDING_AMOUNT,
                output_id,
            )
            .await
    }

    pub async fn prepare_utility_nfts_issuance(&self) -> Result<PreparedUtilityNfts> {
        let tx = self
            .harness
            .process_request(wallet_transfer_request(
                vec![],
                vec![
                    OutputSchema {
                        id: "issuance-utxo-0".into(),
                        amount_sat: UTILITY_ISSUANCE_INPUT_VALUE,
                        lock: LockVariant::Script {
                            script: self.harness.wallet_script_26().clone(),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: asset_id25_to26(self.policy_asset_id)?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "issuance-utxo-1".into(),
                        amount_sat: UTILITY_ISSUANCE_INPUT_VALUE,
                        lock: LockVariant::Script {
                            script: self.harness.wallet_script_26().clone(),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: asset_id25_to26(self.policy_asset_id)?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "issuance-utxo-2".into(),
                        amount_sat: UTILITY_ISSUANCE_INPUT_VALUE,
                        lock: LockVariant::Script {
                            script: self.harness.wallet_script_26().clone(),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: asset_id25_to26(self.policy_asset_id)?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "issuance-utxo-3".into(),
                        amount_sat: UTILITY_ISSUANCE_INPUT_VALUE,
                        lock: LockVariant::Script {
                            script: self.harness.wallet_script_26().clone(),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: asset_id25_to26(self.policy_asset_id)?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                ],
            ))
            .await?;
        let issuance_outputs = tx
            .output
            .iter()
            .enumerate()
            .filter_map(|(vout, tx_out)| {
                (tx_out.script_pubkey == *self.harness.wallet_script_25()
                    && tx_out.asset.explicit() == Some(self.policy_asset_id)
                    && tx_out.value.explicit() == Some(UTILITY_ISSUANCE_INPUT_VALUE))
                .then_some((vout, tx_out.clone()))
            })
            .map(|(vout, tx_out)| {
                known_from_tx_output(&tx, vout, txout25_to26(&tx_out).expect("convert txout"))
            })
            .collect::<Result<Vec<_>>>()?;
        let issuance_utxos: [KnownUtxo; 4] = issuance_outputs
            .try_into()
            .map_err(|_| anyhow!("expected four issuance outputs"))?;

        Ok(PreparedUtilityNfts { issuance_utxos })
    }

    pub async fn issue_utility_nfts(
        &self,
        prepared: &PreparedUtilityNfts,
    ) -> Result<IssuedUtilityNfts> {
        let (first_parameters_amount, second_parameters_amount) =
            self.terms.encode_parameters_nft_amounts(TOKENS_DECIMALS)?;
        let issuance_asset = asset_id25_to26(self.policy_asset_id)?;
        let fee_utxo = self.fund_explicit_policy_fee("issue-fee").await?;
        let tx = self
            .harness
            .process_request(wallet_transfer_request(
                vec![
                    InputSchema {
                        id: "borrower-issuance".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: prepared.issuance_utxos[0].outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::MAX,
                        issuance: Some(InputIssuance {
                            kind: InputIssuanceKind::New,
                            asset_amount_sat: 1,
                            token_amount_sat: 0,
                            entropy: UTILITY_ISSUANCE_ENTROPY,
                        }),
                        finalizer: FinalizerSpec::Wallet,
                    },
                    InputSchema {
                        id: "lender-issuance".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: prepared.issuance_utxos[1].outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::MAX,
                        issuance: Some(InputIssuance {
                            kind: InputIssuanceKind::New,
                            asset_amount_sat: 1,
                            token_amount_sat: 0,
                            entropy: UTILITY_ISSUANCE_ENTROPY,
                        }),
                        finalizer: FinalizerSpec::Wallet,
                    },
                    InputSchema {
                        id: "first-parameters-issuance".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: prepared.issuance_utxos[2].outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::MAX,
                        issuance: Some(InputIssuance {
                            kind: InputIssuanceKind::New,
                            asset_amount_sat: first_parameters_amount,
                            token_amount_sat: 0,
                            entropy: UTILITY_ISSUANCE_ENTROPY,
                        }),
                        finalizer: FinalizerSpec::Wallet,
                    },
                    InputSchema {
                        id: "second-parameters-issuance".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: prepared.issuance_utxos[3].outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::MAX,
                        issuance: Some(InputIssuance {
                            kind: InputIssuanceKind::New,
                            asset_amount_sat: second_parameters_amount,
                            token_amount_sat: 0,
                            entropy: UTILITY_ISSUANCE_ENTROPY,
                        }),
                        finalizer: FinalizerSpec::Wallet,
                    },
                    InputSchema {
                        id: "issue-fee".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: fee_utxo.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: FinalizerSpec::Wallet,
                    },
                ],
                vec![
                    OutputSchema {
                        id: "borrower-nft".into(),
                        amount_sat: 1,
                        lock: LockVariant::Script {
                            script: self.harness.wallet_script_26().clone(),
                        },
                        asset: AssetVariant::NewIssuanceAsset { input_index: 0 },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "lender-nft".into(),
                        amount_sat: 1,
                        lock: LockVariant::Script {
                            script: self.harness.wallet_script_26().clone(),
                        },
                        asset: AssetVariant::NewIssuanceAsset { input_index: 1 },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "first-parameters-nft".into(),
                        amount_sat: first_parameters_amount,
                        lock: LockVariant::Script {
                            script: self.harness.wallet_script_26().clone(),
                        },
                        asset: AssetVariant::NewIssuanceAsset { input_index: 2 },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "second-parameters-nft".into(),
                        amount_sat: second_parameters_amount,
                        lock: LockVariant::Script {
                            script: self.harness.wallet_script_26().clone(),
                        },
                        asset: AssetVariant::NewIssuanceAsset { input_index: 3 },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "return-issuance-0".into(),
                        amount_sat: UTILITY_ISSUANCE_INPUT_VALUE,
                        lock: LockVariant::Script {
                            script: self.harness.wallet_script_26().clone(),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: issuance_asset,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "return-issuance-1".into(),
                        amount_sat: UTILITY_ISSUANCE_INPUT_VALUE,
                        lock: LockVariant::Script {
                            script: self.harness.wallet_script_26().clone(),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: issuance_asset,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "return-issuance-2".into(),
                        amount_sat: UTILITY_ISSUANCE_INPUT_VALUE,
                        lock: LockVariant::Script {
                            script: self.harness.wallet_script_26().clone(),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: issuance_asset,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "return-issuance-3".into(),
                        amount_sat: UTILITY_ISSUANCE_INPUT_VALUE,
                        lock: LockVariant::Script {
                            script: self.harness.wallet_script_26().clone(),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: issuance_asset,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                ],
            ))
            .await?;

        let borrower_nft = self.harness.find_nth_output(
            &tx,
            |tx_out| {
                tx_out.script_pubkey == *self.harness.wallet_script_25()
                    && tx_out.value.explicit() == Some(1)
                    && tx_out.asset.explicit() != Some(self.policy_asset_id)
            },
            0,
        )?;
        let lender_nft = self.harness.find_nth_output(
            &tx,
            |tx_out| {
                tx_out.script_pubkey == *self.harness.wallet_script_25()
                    && tx_out.value.explicit() == Some(1)
                    && tx_out.asset.explicit() != Some(self.policy_asset_id)
            },
            1,
        )?;
        let first_parameters_nft = self.harness.find_output(&tx, |tx_out| {
            tx_out.script_pubkey == *self.harness.wallet_script_25()
                && tx_out.value.explicit() == Some(first_parameters_amount)
                && tx_out.asset.explicit() != Some(self.policy_asset_id)
        })?;
        let second_parameters_nft = self.harness.find_output(&tx, |tx_out| {
            tx_out.script_pubkey == *self.harness.wallet_script_25()
                && tx_out.value.explicit() == Some(second_parameters_amount)
                && tx_out.asset.explicit() != Some(self.policy_asset_id)
        })?;

        Ok(IssuedUtilityNfts {
            borrower_nft,
            lender_nft,
            first_parameters_nft,
            second_parameters_nft,
        })
    }

    pub async fn create_pre_lock(&self, nfts: &IssuedUtilityNfts) -> Result<PreLockState> {
        let lender_asset_auth_arguments =
            AssetAuthArguments::new(nfts.lender_nft.asset_id_25()?.into_inner().0, 1, true);
        let lender_asset_auth_address = create_p2tr_address(
            load_program(
                lending_contracts::asset_auth::ASSET_AUTH_SOURCE,
                lender_asset_auth_arguments.build_asset_auth_arguments(),
            )?
            .commit()
            .cmr(),
            &InternalKeySource::Bip0341.get_x_only_pubkey(),
            lwk_common::Network::LocaltestLiquid.address_params(),
        );
        let lending_arguments = LendingContractArgs::new(
            self.collateral_asset_id.into_inner().0,
            self.principal_asset_id.into_inner().0,
            nfts.borrower_nft.asset_id_25()?.into_inner().0,
            nfts.lender_nft.asset_id_25()?.into_inner().0,
            nfts.first_parameters_nft.asset_id_25()?.into_inner().0,
            nfts.second_parameters_nft.asset_id_25()?.into_inner().0,
            hash_script(&lender_asset_auth_address.script_pubkey()),
            self.terms,
        );
        let lending_address = create_p2tr_address(
            load_program(LENDING_SOURCE, lending_arguments.build_simf_arguments())?
                .commit()
                .cmr(),
            &InternalKeySource::Bip0341.get_x_only_pubkey(),
            lwk_common::Network::LocaltestLiquid.address_params(),
        );
        let parameters_script_auth_arguments =
            ScriptAuthArguments::new(hash_script(&lending_address.script_pubkey()));
        let wallet_script_hash = hash_script(self.harness.wallet_script_25());
        let parameters_script_auth_address = create_p2tr_address(
            load_program(
                lending_contracts::script_auth::SCRIPT_AUTH_SOURCE,
                parameters_script_auth_arguments.build_script_auth_arguments(),
            )?
            .commit()
            .cmr(),
            &InternalKeySource::Bip0341.get_x_only_pubkey(),
            lwk_common::Network::LocaltestLiquid.address_params(),
        );
        let arguments = PreLockContractArgs::new(
            self.collateral_asset_id.into_inner().0,
            self.principal_asset_id.into_inner().0,
            nfts.borrower_nft.asset_id_25()?.into_inner().0,
            nfts.lender_nft.asset_id_25()?.into_inner().0,
            nfts.first_parameters_nft.asset_id_25()?.into_inner().0,
            nfts.second_parameters_nft.asset_id_25()?.into_inner().0,
            hash_script(&lending_address.script_pubkey()),
            hash_script(&parameters_script_auth_address.script_pubkey()),
            wallet_script_hash,
            wallet_script_hash,
            self.harness.signer_x_only_public_key_25()?.serialize(),
            self.terms,
        );
        let pre_lock_address = create_p2tr_address(
            load_program(PRE_LOCK_SOURCE, arguments.build_simf_arguments())?
                .commit()
                .cmr(),
            &InternalKeySource::Bip0341.get_x_only_pubkey(),
            lwk_common::Network::LocaltestLiquid.address_params(),
        );
        let utility_script_auth_arguments =
            ScriptAuthArguments::new(hash_script(&pre_lock_address.script_pubkey()));
        let utility_script_auth_address = create_p2tr_address(
            load_program(
                lending_contracts::script_auth::SCRIPT_AUTH_SOURCE,
                utility_script_auth_arguments.build_script_auth_arguments(),
            )?
            .commit()
            .cmr(),
            &InternalKeySource::Bip0341.get_x_only_pubkey(),
            lwk_common::Network::LocaltestLiquid.address_params(),
        );

        let mut op_return_data = [0u8; 64];
        op_return_data[..32]
            .copy_from_slice(&self.harness.signer_x_only_public_key_25()?.serialize());
        op_return_data[32..64].copy_from_slice(&self.principal_asset_id.into_inner().0);
        let metadata_script = {
            let bytes = el25::encode::serialize(&el25::Script::new_op_return(&op_return_data));
            el26::encode::deserialize(&bytes)?
        };
        let borrower_output_script_metadata_script = {
            let bytes = el25::encode::serialize(&el25::Script::new_op_return(
                self.harness.wallet_script_25().as_bytes(),
            ));
            el26::encode::deserialize(&bytes)?
        };
        let fee_utxo = self.fund_explicit_policy_fee("pre-lock-fee").await?;
        let pre_lock_creation_finalizer = FinalizerSpec::Simf {
            source_simf: PRE_LOCK_SOURCE.to_string(),
            internal_key: InternalKeySource::Bip0341,
            arguments: serialize_arguments(&SimfArguments::new(arguments.build_simf_arguments()))?,
            witness: serialize_witness(&SimfWitness {
                resolved: runtime_pre_lock_lending_creation_witness(),
                runtime_arguments: vec![],
            })?,
        };
        let utility_script_auth_output_finalizer = FinalizerSpec::Simf {
            source_simf: lending_contracts::script_auth::SCRIPT_AUTH_SOURCE.to_string(),
            internal_key: InternalKeySource::Bip0341,
            arguments: serialize_arguments(&SimfArguments::new(
                utility_script_auth_arguments.build_script_auth_arguments(),
            ))?,
            witness: serialize_witness(&SimfWitness {
                resolved: build_script_auth_witness(&ScriptAuthWitnessParams {
                    input_script_index: 0,
                }),
                runtime_arguments: vec![],
            })?,
        };

        let tx = self
            .harness
            .process_request(wallet_transfer_request(
                vec![
                    InputSchema {
                        id: "collateral".into(),
                        utxo_source: UTXOSource::default(),
                        unblinding: InputUnblinding::Wallet,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: FinalizerSpec::Wallet,
                    },
                    InputSchema {
                        id: "first-parameters".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: nfts.first_parameters_nft.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: FinalizerSpec::Wallet,
                    },
                    InputSchema {
                        id: "second-parameters".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: nfts.second_parameters_nft.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: FinalizerSpec::Wallet,
                    },
                    InputSchema {
                        id: "borrower-nft".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: nfts.borrower_nft.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: FinalizerSpec::Wallet,
                    },
                    InputSchema {
                        id: "lender-nft".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: nfts.lender_nft.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: FinalizerSpec::Wallet,
                    },
                    InputSchema {
                        id: "pre-lock-fee".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: fee_utxo.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: FinalizerSpec::Wallet,
                    },
                ],
                vec![
                    OutputSchema {
                        id: "pre-lock".into(),
                        amount_sat: self.terms.collateral_amount,
                        lock: LockVariant::Finalizer {
                            finalizer: Box::new(pre_lock_creation_finalizer),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: asset_id25_to26(self.collateral_asset_id)?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "first-parameters-script-auth".into(),
                        amount_sat: nfts.first_parameters_nft.value()?,
                        lock: LockVariant::Finalizer {
                            finalizer: Box::new(utility_script_auth_output_finalizer.clone()),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: nfts.first_parameters_nft.asset_id_26()?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "second-parameters-script-auth".into(),
                        amount_sat: nfts.second_parameters_nft.value()?,
                        lock: LockVariant::Finalizer {
                            finalizer: Box::new(utility_script_auth_output_finalizer.clone()),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: nfts.second_parameters_nft.asset_id_26()?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "borrower-script-auth".into(),
                        amount_sat: 1,
                        lock: LockVariant::Finalizer {
                            finalizer: Box::new(utility_script_auth_output_finalizer.clone()),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: nfts.borrower_nft.asset_id_26()?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "lender-script-auth".into(),
                        amount_sat: 1,
                        lock: LockVariant::Finalizer {
                            finalizer: Box::new(utility_script_auth_output_finalizer),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: nfts.lender_nft.asset_id_26()?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "pre-lock-metadata".into(),
                        amount_sat: 0,
                        lock: LockVariant::Script {
                            script: metadata_script,
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: el26::AssetId::default(),
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "pre-lock-borrower-output-script-hash".into(),
                        amount_sat: 0,
                        lock: LockVariant::Script {
                            script: borrower_output_script_metadata_script,
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: el26::AssetId::default(),
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                ],
            ))
            .await?;
        let pre_lock = self.harness.find_output(&tx, |tx_out| {
            tx_out.script_pubkey == pre_lock_address.script_pubkey()
                && tx_out.asset.explicit() == Some(self.collateral_asset_id)
                && tx_out.value.explicit() == Some(self.terms.collateral_amount)
        })?;
        let first_parameters_nft = self.harness.find_output(&tx, |tx_out| {
            tx_out.script_pubkey == utility_script_auth_address.script_pubkey()
                && tx_out.asset.explicit()
                    == Some(nfts.first_parameters_nft.asset_id_25().expect("asset"))
                && tx_out.value.explicit()
                    == Some(nfts.first_parameters_nft.value().expect("value"))
        })?;
        let second_parameters_nft = self.harness.find_output(&tx, |tx_out| {
            tx_out.script_pubkey == utility_script_auth_address.script_pubkey()
                && tx_out.asset.explicit()
                    == Some(nfts.second_parameters_nft.asset_id_25().expect("asset"))
                && tx_out.value.explicit()
                    == Some(nfts.second_parameters_nft.value().expect("value"))
        })?;
        let borrower_nft = self.harness.find_output(&tx, |tx_out| {
            tx_out.script_pubkey == utility_script_auth_address.script_pubkey()
                && tx_out.asset.explicit() == Some(nfts.borrower_nft.asset_id_25().expect("asset"))
                && tx_out.value.explicit() == Some(1)
        })?;
        let lender_nft = self.harness.find_output(&tx, |tx_out| {
            tx_out.script_pubkey == utility_script_auth_address.script_pubkey()
                && tx_out.asset.explicit() == Some(nfts.lender_nft.asset_id_25().expect("asset"))
                && tx_out.value.explicit() == Some(1)
        })?;

        Ok(PreLockState {
            arguments,
            utility_script_auth_arguments,
            pre_lock,
            first_parameters_nft,
            second_parameters_nft,
            borrower_nft,
            lender_nft,
        })
    }

    pub async fn cancel_pre_lock(&self, state: &PreLockState) -> Result<KnownUtxo> {
        let fee_utxo = self.fund_explicit_policy_fee("cancel-fee").await?;
        let pre_lock_cancellation_finalizer = FinalizerSpec::Simf {
            source_simf: PRE_LOCK_SOURCE.to_string(),
            internal_key: InternalKeySource::Bip0341,
            arguments: serialize_arguments(&SimfArguments::new(
                state.arguments.build_simf_arguments(),
            ))?,
            witness: serialize_witness(&SimfWitness {
                resolved: runtime_pre_lock_cancellation_path(),
                runtime_arguments: vec![RuntimeSimfWitness::SigHashAll {
                    name: "CANCELLATION_SIGNATURE".to_string(),
                    public_key: self.harness.signer_x_only_public_key_26()?,
                }],
            })?,
        };
        let utility_script_auth_finalizer = FinalizerSpec::Simf {
            source_simf: lending_contracts::script_auth::SCRIPT_AUTH_SOURCE.to_string(),
            internal_key: InternalKeySource::Bip0341,
            arguments: serialize_arguments(&SimfArguments::new(
                state
                    .utility_script_auth_arguments
                    .build_script_auth_arguments(),
            ))?,
            witness: serialize_witness(&SimfWitness {
                resolved: build_script_auth_witness(&lending_script_witness()?),
                runtime_arguments: vec![],
            })?,
        };
        let tx = self
            .harness
            .process_request(wallet_transfer_request(
                vec![
                    InputSchema {
                        id: "pre-lock".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: state.pre_lock.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: pre_lock_cancellation_finalizer,
                    },
                    InputSchema {
                        id: "first-parameters-script-auth".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: state.first_parameters_nft.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: utility_script_auth_finalizer.clone(),
                    },
                    InputSchema {
                        id: "second-parameters-script-auth".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: state.second_parameters_nft.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: utility_script_auth_finalizer.clone(),
                    },
                    InputSchema {
                        id: "borrower-script-auth".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: state.borrower_nft.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: utility_script_auth_finalizer.clone(),
                    },
                    InputSchema {
                        id: "lender-script-auth".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: state.lender_nft.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: utility_script_auth_finalizer,
                    },
                    InputSchema {
                        id: "cancel-fee".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: fee_utxo.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: FinalizerSpec::Wallet,
                    },
                ],
                vec![
                    OutputSchema {
                        id: "collateral-return".into(),
                        amount_sat: self.terms.collateral_amount,
                        lock: LockVariant::Script {
                            script: self.harness.wallet_script_26().clone(),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: asset_id25_to26(self.collateral_asset_id)?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "first-parameters-burn".into(),
                        amount_sat: state.first_parameters_nft.value()?,
                        lock: LockVariant::Script {
                            script: el26::Script::new_op_return(b"burn"),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: state.first_parameters_nft.asset_id_26()?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "second-parameters-burn".into(),
                        amount_sat: state.second_parameters_nft.value()?,
                        lock: LockVariant::Script {
                            script: el26::Script::new_op_return(b"burn"),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: state.second_parameters_nft.asset_id_26()?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "borrower-burn".into(),
                        amount_sat: state.borrower_nft.value()?,
                        lock: LockVariant::Script {
                            script: el26::Script::new_op_return(b"burn"),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: state.borrower_nft.asset_id_26()?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "lender-burn".into(),
                        amount_sat: state.lender_nft.value()?,
                        lock: LockVariant::Script {
                            script: el26::Script::new_op_return(b"burn"),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: state.lender_nft.asset_id_26()?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                ],
            ))
            .await?;
        self.harness.find_output(&tx, |tx_out| {
            tx_out.script_pubkey == *self.harness.wallet_script_25()
                && tx_out.asset.explicit() == Some(self.collateral_asset_id)
                && tx_out.value.explicit() == Some(self.terms.collateral_amount)
        })
    }

    pub async fn create_lending(&self, state: &PreLockState) -> Result<LendingState> {
        let lender_asset_auth_arguments =
            AssetAuthArguments::new(state.lender_nft.asset_id_25()?.into_inner().0, 1, true);
        let lender_asset_auth_address = create_p2tr_address(
            load_program(
                lending_contracts::asset_auth::ASSET_AUTH_SOURCE,
                lender_asset_auth_arguments.build_asset_auth_arguments(),
            )?
            .commit()
            .cmr(),
            &InternalKeySource::Bip0341.get_x_only_pubkey(),
            lwk_common::Network::LocaltestLiquid.address_params(),
        );
        let arguments = LendingContractArgs::new(
            self.collateral_asset_id.into_inner().0,
            self.principal_asset_id.into_inner().0,
            state.borrower_nft.asset_id_25()?.into_inner().0,
            state.lender_nft.asset_id_25()?.into_inner().0,
            state.first_parameters_nft.asset_id_25()?.into_inner().0,
            state.second_parameters_nft.asset_id_25()?.into_inner().0,
            hash_script(&lender_asset_auth_address.script_pubkey()),
            self.terms,
        );
        let lending_address = create_p2tr_address(
            load_program(LENDING_SOURCE, arguments.build_simf_arguments())?
                .commit()
                .cmr(),
            &InternalKeySource::Bip0341.get_x_only_pubkey(),
            lwk_common::Network::LocaltestLiquid.address_params(),
        );
        let parameters_script_auth_arguments =
            ScriptAuthArguments::new(hash_script(&lending_address.script_pubkey()));
        let parameters_script_auth_address = create_p2tr_address(
            load_program(
                lending_contracts::script_auth::SCRIPT_AUTH_SOURCE,
                parameters_script_auth_arguments.build_script_auth_arguments(),
            )?
            .commit()
            .cmr(),
            &InternalKeySource::Bip0341.get_x_only_pubkey(),
            lwk_common::Network::LocaltestLiquid.address_params(),
        );
        let fee_utxo = self.fund_explicit_policy_fee("lending-fee").await?;
        let pre_lock_creation_finalizer = FinalizerSpec::Simf {
            source_simf: PRE_LOCK_SOURCE.to_string(),
            internal_key: InternalKeySource::Bip0341,
            arguments: serialize_arguments(&SimfArguments::new(
                state.arguments.build_simf_arguments(),
            ))?,
            witness: serialize_witness(&SimfWitness {
                resolved: runtime_pre_lock_lending_creation_witness(),
                runtime_arguments: vec![],
            })?,
        };
        let utility_script_auth_finalizer = FinalizerSpec::Simf {
            source_simf: lending_contracts::script_auth::SCRIPT_AUTH_SOURCE.to_string(),
            internal_key: InternalKeySource::Bip0341,
            arguments: serialize_arguments(&SimfArguments::new(
                state
                    .utility_script_auth_arguments
                    .build_script_auth_arguments(),
            ))?,
            witness: serialize_witness(&SimfWitness {
                resolved: build_script_auth_witness(&lending_script_witness()?),
                runtime_arguments: vec![],
            })?,
        };
        let lending_output_finalizer = FinalizerSpec::Simf {
            source_simf: LENDING_SOURCE.to_string(),
            internal_key: InternalKeySource::Bip0341,
            arguments: serialize_arguments(&SimfArguments::new(arguments.build_simf_arguments()))?,
            witness: serialize_witness(&SimfWitness {
                resolved: build_lending_witness(LendingBranch::LoanRepayment),
                runtime_arguments: vec![],
            })?,
        };
        let parameters_script_auth_output_finalizer = FinalizerSpec::Simf {
            source_simf: lending_contracts::script_auth::SCRIPT_AUTH_SOURCE.to_string(),
            internal_key: InternalKeySource::Bip0341,
            arguments: serialize_arguments(&SimfArguments::new(
                parameters_script_auth_arguments.build_script_auth_arguments(),
            ))?,
            witness: serialize_witness(&SimfWitness {
                resolved: build_script_auth_witness(&ScriptAuthWitnessParams {
                    input_script_index: 0,
                }),
                runtime_arguments: vec![],
            })?,
        };

        let tx = self
            .harness
            .process_request(wallet_transfer_request(
                vec![
                    InputSchema {
                        id: "pre-lock".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: state.pre_lock.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: pre_lock_creation_finalizer,
                    },
                    InputSchema {
                        id: "first-parameters-script-auth".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: state.first_parameters_nft.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: utility_script_auth_finalizer.clone(),
                    },
                    InputSchema {
                        id: "second-parameters-script-auth".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: state.second_parameters_nft.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: utility_script_auth_finalizer.clone(),
                    },
                    InputSchema {
                        id: "borrower-script-auth".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: state.borrower_nft.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: utility_script_auth_finalizer.clone(),
                    },
                    InputSchema {
                        id: "lender-script-auth".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: state.lender_nft.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: utility_script_auth_finalizer,
                    },
                    InputSchema {
                        id: "principal-lend".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: self.principal_lend_utxo.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: FinalizerSpec::Wallet,
                    },
                    InputSchema {
                        id: "lending-fee".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: fee_utxo.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: FinalizerSpec::Wallet,
                    },
                ],
                vec![
                    OutputSchema {
                        id: "lending".into(),
                        amount_sat: self.terms.collateral_amount,
                        lock: LockVariant::Finalizer {
                            finalizer: Box::new(lending_output_finalizer),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: asset_id25_to26(self.collateral_asset_id)?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "principal-to-wallet".into(),
                        amount_sat: self.terms.principal_amount,
                        lock: LockVariant::Script {
                            script: self.harness.wallet_script_26().clone(),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: asset_id25_to26(self.principal_asset_id)?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "first-parameters-script-auth".into(),
                        amount_sat: state.first_parameters_nft.value()?,
                        lock: LockVariant::Finalizer {
                            finalizer: Box::new(parameters_script_auth_output_finalizer.clone()),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: state.first_parameters_nft.asset_id_26()?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "second-parameters-script-auth".into(),
                        amount_sat: state.second_parameters_nft.value()?,
                        lock: LockVariant::Finalizer {
                            finalizer: Box::new(parameters_script_auth_output_finalizer),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: state.second_parameters_nft.asset_id_26()?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "borrower-nft-to-wallet".into(),
                        amount_sat: 1,
                        lock: LockVariant::Script {
                            script: self.harness.wallet_script_26().clone(),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: state.borrower_nft.asset_id_26()?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "lender-nft-to-wallet".into(),
                        amount_sat: 1,
                        lock: LockVariant::Script {
                            script: self.harness.wallet_script_26().clone(),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: state.lender_nft.asset_id_26()?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                ],
            ))
            .await?;
        let lending = self.harness.find_output(&tx, |tx_out| {
            tx_out.script_pubkey == lending_address.script_pubkey()
                && tx_out.asset.explicit() == Some(self.collateral_asset_id)
                && tx_out.value.explicit() == Some(self.terms.collateral_amount)
        })?;
        let first_parameters_nft = self.harness.find_output(&tx, |tx_out| {
            tx_out.script_pubkey == parameters_script_auth_address.script_pubkey()
                && tx_out.asset.explicit()
                    == Some(state.first_parameters_nft.asset_id_25().expect("asset"))
                && tx_out.value.explicit()
                    == Some(state.first_parameters_nft.value().expect("value"))
        })?;
        let second_parameters_nft = self.harness.find_output(&tx, |tx_out| {
            tx_out.script_pubkey == parameters_script_auth_address.script_pubkey()
                && tx_out.asset.explicit()
                    == Some(state.second_parameters_nft.asset_id_25().expect("asset"))
                && tx_out.value.explicit()
                    == Some(state.second_parameters_nft.value().expect("value"))
        })?;
        let borrower_nft = self.harness.find_output(&tx, |tx_out| {
            tx_out.script_pubkey == *self.harness.wallet_script_25()
                && tx_out.asset.explicit() == Some(state.borrower_nft.asset_id_25().expect("asset"))
                && tx_out.value.explicit() == Some(1)
        })?;
        let lender_nft = self.harness.find_output(&tx, |tx_out| {
            tx_out.script_pubkey == *self.harness.wallet_script_25()
                && tx_out.asset.explicit() == Some(state.lender_nft.asset_id_25().expect("asset"))
                && tx_out.value.explicit() == Some(1)
        })?;
        let principal_borrowed = self.harness.find_output(&tx, |tx_out| {
            tx_out.script_pubkey == *self.harness.wallet_script_25()
                && tx_out.asset.explicit() == Some(self.principal_asset_id)
                && tx_out.value.explicit() == Some(self.terms.principal_amount)
        })?;

        Ok(LendingState {
            arguments,
            parameters_script_auth_arguments,
            lender_asset_auth_arguments,
            lending,
            first_parameters_nft,
            second_parameters_nft,
            borrower_nft,
            lender_nft,
            principal_borrowed,
        })
    }

    pub async fn repay_loan(&self, state: &LendingState) -> Result<RepaymentState> {
        let fee_utxo = self.fund_explicit_policy_fee("repayment-fee").await?;
        let lending_repayment_finalizer = FinalizerSpec::Simf {
            source_simf: LENDING_SOURCE.to_string(),
            internal_key: InternalKeySource::Bip0341,
            arguments: serialize_arguments(&SimfArguments::new(
                state.arguments.build_simf_arguments(),
            ))?,
            witness: serialize_witness(&SimfWitness {
                resolved: build_lending_witness(LendingBranch::LoanRepayment),
                runtime_arguments: vec![],
            })?,
        };
        let parameters_script_auth_finalizer = FinalizerSpec::Simf {
            source_simf: lending_contracts::script_auth::SCRIPT_AUTH_SOURCE.to_string(),
            internal_key: InternalKeySource::Bip0341,
            arguments: serialize_arguments(&SimfArguments::new(
                state
                    .parameters_script_auth_arguments
                    .build_script_auth_arguments(),
            ))?,
            witness: serialize_witness(&SimfWitness {
                resolved: build_script_auth_witness(&lending_script_witness()?),
                runtime_arguments: vec![],
            })?,
        };
        let lender_asset_auth_output_finalizer = FinalizerSpec::Simf {
            source_simf: lending_contracts::asset_auth::ASSET_AUTH_SOURCE.to_string(),
            internal_key: InternalKeySource::Bip0341,
            arguments: serialize_arguments(&SimfArguments::new(
                state
                    .lender_asset_auth_arguments
                    .build_asset_auth_arguments(),
            ))?,
            witness: serialize_witness(&SimfWitness {
                resolved: build_asset_auth_witness(&AssetAuthWitnessParams {
                    input_asset_index: 0,
                    output_asset_index: 0,
                }),
                runtime_arguments: vec![],
            })?,
        };
        let lender_asset_auth_address = create_p2tr_address(
            load_program(
                lending_contracts::asset_auth::ASSET_AUTH_SOURCE,
                state
                    .lender_asset_auth_arguments
                    .build_asset_auth_arguments(),
            )?
            .commit()
            .cmr(),
            &InternalKeySource::Bip0341.get_x_only_pubkey(),
            lwk_common::Network::LocaltestLiquid.address_params(),
        );
        let tx = self
            .harness
            .process_request(wallet_transfer_request(
                vec![
                    InputSchema {
                        id: "lending".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: state.lending.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: lending_repayment_finalizer,
                    },
                    InputSchema {
                        id: "first-parameters-script-auth".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: state.first_parameters_nft.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: parameters_script_auth_finalizer.clone(),
                    },
                    InputSchema {
                        id: "second-parameters-script-auth".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: state.second_parameters_nft.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: parameters_script_auth_finalizer,
                    },
                    InputSchema {
                        id: "borrower-nft".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: state.borrower_nft.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: FinalizerSpec::Wallet,
                    },
                    InputSchema {
                        id: "principal-repay".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: self.principal_repay_utxo.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: FinalizerSpec::Wallet,
                    },
                    InputSchema {
                        id: "repayment-fee".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: fee_utxo.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: FinalizerSpec::Wallet,
                    },
                ],
                vec![
                    OutputSchema {
                        id: "collateral-return".into(),
                        amount_sat: self.terms.collateral_amount,
                        lock: LockVariant::Script {
                            script: self.harness.wallet_script_26().clone(),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: asset_id25_to26(self.collateral_asset_id)?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "lender-asset-auth".into(),
                        amount_sat: self.terms.principal_with_interest(),
                        lock: LockVariant::Finalizer {
                            finalizer: Box::new(lender_asset_auth_output_finalizer),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: asset_id25_to26(self.principal_asset_id)?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "first-parameters-burn".into(),
                        amount_sat: state.first_parameters_nft.value()?,
                        lock: LockVariant::Script {
                            script: el26::Script::new_op_return(b"burn"),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: state.first_parameters_nft.asset_id_26()?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "second-parameters-burn".into(),
                        amount_sat: state.second_parameters_nft.value()?,
                        lock: LockVariant::Script {
                            script: el26::Script::new_op_return(b"burn"),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: state.second_parameters_nft.asset_id_26()?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "borrower-burn".into(),
                        amount_sat: state.borrower_nft.value()?,
                        lock: LockVariant::Script {
                            script: el26::Script::new_op_return(b"burn"),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: state.borrower_nft.asset_id_26()?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                ],
            ))
            .await?;
        let asset_auth = self.harness.find_output(&tx, |tx_out| {
            tx_out.script_pubkey == lender_asset_auth_address.script_pubkey()
                && tx_out.asset.explicit() == Some(self.principal_asset_id)
                && tx_out.value.explicit() == Some(self.terms.principal_with_interest())
        })?;
        let collateral = self.harness.find_output(&tx, |tx_out| {
            tx_out.script_pubkey == *self.harness.wallet_script_25()
                && tx_out.asset.explicit() == Some(self.collateral_asset_id)
                && tx_out.value.explicit() == Some(self.terms.collateral_amount)
        })?;

        Ok(RepaymentState {
            asset_auth_arguments: state.lender_asset_auth_arguments.clone(),
            asset_auth,
            collateral,
            lender_nft: state.lender_nft.clone(),
        })
    }

    pub async fn claim_repaid_principal(&self, state: &RepaymentState) -> Result<ClaimState> {
        let fee_utxo = self.fund_explicit_policy_fee("claim-fee").await?;
        let asset_auth_claim_finalizer = FinalizerSpec::Simf {
            source_simf: lending_contracts::asset_auth::ASSET_AUTH_SOURCE.to_string(),
            internal_key: InternalKeySource::Bip0341,
            arguments: serialize_arguments(&SimfArguments::new(
                state.asset_auth_arguments.build_asset_auth_arguments(),
            ))?,
            witness: serialize_witness(&SimfWitness {
                resolved: build_asset_auth_witness(&lending_asset_auth_claim_witness()),
                runtime_arguments: vec![],
            })?,
        };
        let tx = self
            .harness
            .process_request(wallet_transfer_request(
                vec![
                    InputSchema {
                        id: "asset-auth".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: state.asset_auth.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: asset_auth_claim_finalizer,
                    },
                    InputSchema {
                        id: "lender-nft".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: state.lender_nft.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: FinalizerSpec::Wallet,
                    },
                    InputSchema {
                        id: "claim-fee".into(),
                        utxo_source: UTXOSource::Provided {
                            outpoint: fee_utxo.outpoint,
                        },
                        unblinding: InputUnblinding::Explicit,
                        sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                        issuance: None,
                        finalizer: FinalizerSpec::Wallet,
                    },
                ],
                vec![
                    OutputSchema {
                        id: "principal-claim".into(),
                        amount_sat: self.terms.principal_with_interest(),
                        lock: LockVariant::Script {
                            script: self.harness.wallet_script_26().clone(),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: asset_id25_to26(self.principal_asset_id)?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                    OutputSchema {
                        id: "lender-burn".into(),
                        amount_sat: 1,
                        lock: LockVariant::Script {
                            script: el26::Script::new_op_return(b"burn"),
                        },
                        asset: AssetVariant::AssetId {
                            asset_id: state.lender_nft.asset_id_26()?,
                        },
                        blinder: BlinderVariant::Explicit,
                    },
                ],
            ))
            .await?;
        let principal_claim = self.harness.find_output(&tx, |tx_out| {
            tx_out.script_pubkey == *self.harness.wallet_script_25()
                && tx_out.asset.explicit() == Some(self.principal_asset_id)
                && tx_out.value.explicit() == Some(self.terms.principal_with_interest())
        })?;

        Ok(ClaimState { principal_claim })
    }

    pub async fn liquidate_loan(&self, state: &LendingState) -> Result<LiquidationState> {
        let current_tip = self.harness.current_tip_height().await?;
        let blocks_to_mine = self
            .terms
            .loan_expiration_time
            .saturating_sub(current_tip)
            .saturating_add(1);
        if blocks_to_mine > 0 {
            self.harness.mine_and_sync(blocks_to_mine as usize).await?;
        }
        let fee_utxo = self.fund_explicit_policy_fee("liquidation-fee").await?;
        let lending_liquidation_finalizer = FinalizerSpec::Simf {
            source_simf: LENDING_SOURCE.to_string(),
            internal_key: InternalKeySource::Bip0341,
            arguments: serialize_arguments(&SimfArguments::new(
                state.arguments.build_simf_arguments(),
            ))?,
            witness: serialize_witness(&SimfWitness {
                resolved: build_lending_witness(LendingBranch::LoanLiquidation),
                runtime_arguments: vec![],
            })?,
        };
        let parameters_script_auth_finalizer = FinalizerSpec::Simf {
            source_simf: lending_contracts::script_auth::SCRIPT_AUTH_SOURCE.to_string(),
            internal_key: InternalKeySource::Bip0341,
            arguments: serialize_arguments(&SimfArguments::new(
                state
                    .parameters_script_auth_arguments
                    .build_script_auth_arguments(),
            ))?,
            witness: serialize_witness(&SimfWitness {
                resolved: build_script_auth_witness(&lending_script_witness()?),
                runtime_arguments: vec![],
            })?,
        };

        let tx = self
            .harness
            .process_request({
                let mut request = wallet_transfer_request(
                    vec![
                        InputSchema {
                            id: "lending".into(),
                            utxo_source: UTXOSource::Provided {
                                outpoint: state.lending.outpoint,
                            },
                            unblinding: InputUnblinding::Explicit,
                            sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                            issuance: None,
                            finalizer: lending_liquidation_finalizer,
                        },
                        InputSchema {
                            id: "first-parameters-script-auth".into(),
                            utxo_source: UTXOSource::Provided {
                                outpoint: state.first_parameters_nft.outpoint,
                            },
                            unblinding: InputUnblinding::Explicit,
                            sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                            issuance: None,
                            finalizer: parameters_script_auth_finalizer.clone(),
                        },
                        InputSchema {
                            id: "second-parameters-script-auth".into(),
                            utxo_source: UTXOSource::Provided {
                                outpoint: state.second_parameters_nft.outpoint,
                            },
                            unblinding: InputUnblinding::Explicit,
                            sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                            issuance: None,
                            finalizer: parameters_script_auth_finalizer,
                        },
                        InputSchema {
                            id: "lender-nft".into(),
                            utxo_source: UTXOSource::Provided {
                                outpoint: state.lender_nft.outpoint,
                            },
                            unblinding: InputUnblinding::Explicit,
                            sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                            issuance: None,
                            finalizer: FinalizerSpec::Wallet,
                        },
                        InputSchema {
                            id: "liquidation-fee".into(),
                            utxo_source: UTXOSource::Provided {
                                outpoint: fee_utxo.outpoint,
                            },
                            unblinding: InputUnblinding::Explicit,
                            sequence: el26::Sequence::ENABLE_LOCKTIME_NO_RBF,
                            issuance: None,
                            finalizer: FinalizerSpec::Wallet,
                        },
                    ],
                    vec![
                        OutputSchema {
                            id: "collateral-return".into(),
                            amount_sat: self.terms.collateral_amount,
                            lock: LockVariant::Script {
                                script: self.harness.wallet_script_26().clone(),
                            },
                            asset: AssetVariant::AssetId {
                                asset_id: asset_id25_to26(self.collateral_asset_id)?,
                            },
                            blinder: BlinderVariant::Explicit,
                        },
                        OutputSchema {
                            id: "first-parameters-burn".into(),
                            amount_sat: state.first_parameters_nft.value()?,
                            lock: LockVariant::Script {
                                script: el26::Script::new_op_return(b"burn"),
                            },
                            asset: AssetVariant::AssetId {
                                asset_id: state.first_parameters_nft.asset_id_26()?,
                            },
                            blinder: BlinderVariant::Explicit,
                        },
                        OutputSchema {
                            id: "second-parameters-burn".into(),
                            amount_sat: state.second_parameters_nft.value()?,
                            lock: LockVariant::Script {
                                script: el26::Script::new_op_return(b"burn"),
                            },
                            asset: AssetVariant::AssetId {
                                asset_id: state.second_parameters_nft.asset_id_26()?,
                            },
                            blinder: BlinderVariant::Explicit,
                        },
                        OutputSchema {
                            id: "lender-burn".into(),
                            amount_sat: 1,
                            lock: LockVariant::Script {
                                script: el26::Script::new_op_return(b"burn"),
                            },
                            asset: AssetVariant::AssetId {
                                asset_id: state.lender_nft.asset_id_26()?,
                            },
                            blinder: BlinderVariant::Explicit,
                        },
                    ],
                );
                request.params.lock_time = Some(el26::LockTime::from_height(
                    self.terms.loan_expiration_time,
                )?);
                request
            })
            .await?;
        let collateral = self.harness.find_output(&tx, |tx_out| {
            tx_out.script_pubkey == *self.harness.wallet_script_25()
                && tx_out.asset.explicit() == Some(self.collateral_asset_id)
                && tx_out.value.explicit() == Some(self.terms.collateral_amount)
        })?;

        Ok(LiquidationState { collateral })
    }
}

fn runtime_pre_lock_cancellation_path() -> WitnessValues {
    let path_type = ResolvedType::either(
        ResolvedType::parse_from_str("()").expect("valid type"),
        ResolvedType::parse_from_str("()").expect("valid type"),
    );
    WitnessValues::from(HashMap::from([(
        WitnessName::from_str_unchecked("PATH"),
        Value::parse_from_str("Right(())", &path_type).expect("valid witness"),
    )]))
}

fn runtime_pre_lock_lending_creation_witness() -> WitnessValues {
    let path_type = ResolvedType::either(
        ResolvedType::parse_from_str("()").expect("valid type"),
        ResolvedType::parse_from_str("()").expect("valid type"),
    );
    WitnessValues::from(HashMap::from([
        (
            WitnessName::from_str_unchecked("PATH"),
            Value::parse_from_str("Left(())", &path_type).expect("valid witness"),
        ),
        (
            WitnessName::from_str_unchecked("CANCELLATION_SIGNATURE"),
            Value::byte_array([0u8; 64]),
        ),
    ]))
}

const fn lending_script_witness()
-> Result<lending_contracts::script_auth::build_witness::ScriptAuthWitnessParams> {
    Ok(
        lending_contracts::script_auth::build_witness::ScriptAuthWitnessParams {
            input_script_index: 0,
        },
    )
}

const fn lending_asset_auth_claim_witness()
-> lending_contracts::asset_auth::build_witness::AssetAuthWitnessParams {
    lending_contracts::asset_auth::build_witness::AssetAuthWitnessParams {
        input_asset_index: 1,
        output_asset_index: 1,
    }
}

fn argument_u256(name: &str, bytes: [u8; 32]) -> (WitnessName, simplicityhl::Value) {
    (
        WitnessName::from_str_unchecked(name),
        simplicityhl::Value::from(UIntValue::U256(U256::from_byte_array(bytes))),
    )
}

fn argument_u64(name: &str, value: u64) -> (WitnessName, simplicityhl::Value) {
    (
        WitnessName::from_str_unchecked(name),
        simplicityhl::Value::from(UIntValue::U64(value)),
    )
}

fn argument_u32(name: &str, value: u32) -> (WitnessName, simplicityhl::Value) {
    (
        WitnessName::from_str_unchecked(name),
        simplicityhl::Value::from(UIntValue::U32(value)),
    )
}

fn argument_u16(name: &str, value: u16) -> (WitnessName, simplicityhl::Value) {
    (
        WitnessName::from_str_unchecked(name),
        simplicityhl::Value::from(UIntValue::U16(value)),
    )
}

fn calculate_principal_with_interest(principal_amount: u64, interest_rate: u16) -> u64 {
    let interest =
        (u128::from(principal_amount) * u128::from(interest_rate)) / u128::from(MAX_BASIS_POINTS);
    principal_amount
        .checked_add(u64::try_from(interest).expect("interest fits in u64"))
        .expect("principal with interest overflow")
}

fn encode_first_parameters_nft(
    interest_rate: u16,
    loan_expiration_time: u32,
    collateral_dec: u8,
    principal_dec: u8,
) -> Result<u64> {
    if loan_expiration_time >= (1 << 27) {
        return Err(anyhow!(
            "parameter value out of bounds: loan expiration time"
        ));
    }
    if collateral_dec >= (1 << 4) {
        return Err(anyhow!(
            "parameter value out of bounds: collateral decimals"
        ));
    }
    if principal_dec >= (1 << 4) {
        return Err(anyhow!("parameter value out of bounds: principal decimals"));
    }

    Ok(u64::from(interest_rate)
        | (u64::from(loan_expiration_time) << 16)
        | (u64::from(collateral_dec) << 43)
        | (u64::from(principal_dec) << 47))
}

fn encode_second_parameters_nft(
    collateral_base_amount: u32,
    principal_base_amount: u32,
) -> Result<u64> {
    if collateral_base_amount >= (1 << 25) {
        return Err(anyhow!(
            "parameter value out of bounds: collateral base amount"
        ));
    }
    if principal_base_amount >= (1 << 25) {
        return Err(anyhow!(
            "parameter value out of bounds: principal base amount"
        ));
    }

    Ok(u64::from(collateral_base_amount) | (u64::from(principal_base_amount) << 25))
}

fn to_base_amount(amount: u64, decimals_mantissa: u8) -> u32 {
    let divisor = *POWERS_OF_10
        .get(decimals_mantissa as usize)
        .expect("decimals mantissa must be between 0 and 15");
    amount
        .checked_div(divisor)
        .expect("division by zero")
        .try_into()
        .expect("base amount greater than u32")
}

fn asset_id25_to26(value: el25::AssetId) -> Result<el26::AssetId> {
    value
        .to_string()
        .parse::<el26::AssetId>()
        .context("failed to convert asset id from elements 0.25 to 0.26")
}

fn asset_id26_to25(value: el26::AssetId) -> Result<el25::AssetId> {
    value
        .to_string()
        .parse::<el25::AssetId>()
        .context("failed to convert asset id from elements 0.26 to 0.25")
}

fn xonly26_to25(value: &secp26::XOnlyPublicKey) -> Result<el25::schnorr::XOnlyPublicKey> {
    el25::schnorr::XOnlyPublicKey::from_slice(&value.serialize())
        .context("failed to convert x-only public key")
}
