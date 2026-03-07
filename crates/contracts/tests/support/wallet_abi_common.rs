use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicU64, Ordering};

use anyhow::{Context, Result, anyhow, bail};
use lwk_common::Network as RuntimeNetwork;
use lwk_simplicity::wallet_abi::schema::{
    InputSchema, OutputSchema, RuntimeParams, TX_CREATE_ABI_VERSION, TxCreateRequest,
    generate_request_id,
};
use lwk_simplicity::wallet_abi::test_utils::{
    TestSignerMeta, TestWalletMeta, build_runtime_parts_random, get_esplora_url, mine_blocks,
};
use lwk_simplicity::wallet_abi::tx_resolution::runtime::Runtime;
use lwk_wollet::elements as el26;
use lwk_wollet::elements::hex::FromHex;
use simplicityhl::elements as el25;
use tokio::sync::{Mutex, OwnedMutexGuard};
use tokio::time::sleep;

static REGTEST_MUTEX: LazyLock<Arc<Mutex<()>>> = LazyLock::new(|| Arc::new(Mutex::new(())));
static WALLET_DATA_COUNTER: AtomicU64 = AtomicU64::new(0);

const REGTEST_PROCESS_LOCK_PORT: u16 = 45_193;
const REGTEST_PROCESS_LOCK_RETRIES: usize = 600;
const REGTEST_PROCESS_LOCK_DELAY: std::time::Duration = std::time::Duration::from_millis(500);

#[derive(Clone, Debug)]
pub struct KnownUtxo {
    pub outpoint: el26::OutPoint,
    pub tx_out_26: el26::TxOut,
    pub tx_out_25: el25::TxOut,
}

impl KnownUtxo {
    pub fn asset_id_26(&self) -> Result<el26::AssetId> {
        self.tx_out_26
            .asset
            .explicit()
            .context("expected explicit asset in elements 0.26 txout")
    }

    pub fn asset_id_25(&self) -> Result<el25::AssetId> {
        self.tx_out_25
            .asset
            .explicit()
            .context("expected explicit asset in elements 0.25 txout")
    }

    pub fn value(&self) -> Result<u64> {
        self.tx_out_25
            .value
            .explicit()
            .context("expected explicit value")
    }
}

pub struct WalletAbiHarness {
    _guard: OwnedMutexGuard<()>,
    _process_lock: TcpListener,
    pub(crate) signer_meta: TestSignerMeta,
    pub(crate) wallet_meta: TestWalletMeta,
    pub signer_address: el26::Address,
    wallet_script_25: el25::Script,
    wallet_script_26: el26::Script,
}

impl WalletAbiHarness {
    pub async fn new() -> Result<Self> {
        let guard = REGTEST_MUTEX.clone().lock_owned().await;
        let process_lock = acquire_regtest_process_lock().await?;
        let esplora_url = get_esplora_url()?;
        let (signer_meta, wallet_meta) = build_runtime_parts_random(
            RuntimeNetwork::LocaltestLiquid,
            &esplora_url,
            wallet_data_root(),
        )
        .await?;
        let signer_address = signer_meta.signer_receive_address()?;

        Ok(Self {
            _guard: guard,
            _process_lock: process_lock,
            signer_meta,
            wallet_meta,
            signer_address: signer_address.clone(),
            wallet_script_25: script26_to25(&signer_address.script_pubkey())?,
            wallet_script_26: signer_address.script_pubkey(),
        })
    }

    pub const fn wallet_script_25(&self) -> &el25::Script {
        &self.wallet_script_25
    }

    pub const fn wallet_script_26(&self) -> &el26::Script {
        &self.wallet_script_26
    }

    pub async fn sync_wallet(&self) -> Result<()> {
        self.wallet_meta.sync_wallet().await?;
        Ok(())
    }

    pub async fn mine_and_sync(&self, blocks: usize) -> Result<()> {
        mine_blocks(blocks)?;
        self.sync_wallet().await
    }

    pub async fn process_request(&self, request: TxCreateRequest) -> Result<el25::Transaction> {
        self.sync_wallet().await?;

        let response = Runtime::build(request, &self.signer_meta, &self.wallet_meta)
            .process_request()
            .await?;
        let tx_info = response
            .transaction
            .context("wallet abi runtime did not return transaction info")?;
        let tx26 = decode_tx_hex(&tx_info.tx_hex)?;

        if tx_info.txid != tx26.txid() {
            bail!(
                "wallet abi txid mismatch: response {} != decoded {}",
                tx_info.txid,
                tx26.txid()
            );
        }

        self.mine_and_sync(1).await?;

        tx26_to25(&tx26)
    }

    pub fn find_output(
        &self,
        tx: &el25::Transaction,
        predicate: impl Fn(&el25::TxOut) -> bool,
    ) -> Result<KnownUtxo> {
        let matches = tx
            .output
            .iter()
            .enumerate()
            .filter_map(|(vout, tx_out)| predicate(tx_out).then_some((vout, tx_out.clone())))
            .collect::<Vec<_>>();
        if matches.len() != 1 {
            bail!(
                "expected exactly one matching output, found {}",
                matches.len()
            );
        }
        let (vout, tx_out) = matches.into_iter().next().expect("checked len");
        let tx_out_26 = txout25_to26(&tx_out)?;
        known_from_tx_output(tx, vout, tx_out_26)
    }
}

pub fn wallet_transfer_request(
    inputs: Vec<InputSchema>,
    outputs: Vec<OutputSchema>,
) -> TxCreateRequest {
    TxCreateRequest {
        abi_version: TX_CREATE_ABI_VERSION.to_string(),
        request_id: generate_request_id(),
        network: RuntimeNetwork::LocaltestLiquid,
        params: RuntimeParams {
            inputs,
            outputs,
            fee_rate_sat_kvb: Some(0.1),
            lock_time: None,
        },
        broadcast: true,
    }
}

async fn acquire_regtest_process_lock() -> Result<TcpListener> {
    let lock_address = ("127.0.0.1", REGTEST_PROCESS_LOCK_PORT);
    for attempt in 0..REGTEST_PROCESS_LOCK_RETRIES {
        match TcpListener::bind(lock_address) {
            Ok(listener) => return Ok(listener),
            Err(err) if err.kind() == std::io::ErrorKind::AddrInUse => {
                if attempt + 1 == REGTEST_PROCESS_LOCK_RETRIES {
                    bail!(
                        "timed out waiting for Wallet ABI regtest lock on 127.0.0.1:{REGTEST_PROCESS_LOCK_PORT}"
                    );
                }
                sleep(REGTEST_PROCESS_LOCK_DELAY).await;
            }
            Err(err) => {
                return Err(err).context(format!(
                    "failed to bind Wallet ABI regtest lock on 127.0.0.1:{REGTEST_PROCESS_LOCK_PORT}"
                ));
            }
        }
    }

    unreachable!("lock acquisition either succeeds or returns an error")
}

fn decode_tx_hex(tx_hex: &str) -> Result<el26::Transaction> {
    let bytes = Vec::<u8>::from_hex(tx_hex)
        .map_err(|error| anyhow!("failed to decode transaction hex: {error}"))?;
    Ok(el26::encode::deserialize(&bytes)?)
}

pub fn known_from_tx_output(
    tx: &el25::Transaction,
    vout: usize,
    tx_out_26: el26::TxOut,
) -> Result<KnownUtxo> {
    Ok(KnownUtxo {
        outpoint: el26::OutPoint::new(
            tx.txid().to_string().parse::<el26::Txid>()?,
            u32::try_from(vout).context("vout does not fit in u32")?,
        ),
        tx_out_25: tx
            .output
            .get(vout)
            .cloned()
            .ok_or_else(|| anyhow!("transaction missing output {vout}"))?,
        tx_out_26,
    })
}

fn wallet_data_root() -> PathBuf {
    let base = std::env::var_os("SIMPLICITY_CLI_WALLET_DATA_DIR").map_or_else(
        || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.cache/wallet"),
        PathBuf::from,
    );
    let unique_index = WALLET_DATA_COUNTER.fetch_add(1, Ordering::Relaxed);
    base.join(format!(
        "wallet-abi-lending-test-wallet-{}-{unique_index}",
        std::process::id()
    ))
}

pub fn txout25_to26(value: &el25::TxOut) -> Result<el26::TxOut> {
    let bytes = el25::encode::serialize(value);
    Ok(el26::encode::deserialize(&bytes)?)
}

fn tx26_to25(value: &el26::Transaction) -> Result<el25::Transaction> {
    let bytes = el26::encode::serialize(value);
    Ok(el25::encode::deserialize(&bytes)?)
}

fn script26_to25(value: &el26::Script) -> Result<el25::Script> {
    let bytes = el26::encode::serialize(value);
    Ok(el25::encode::deserialize(&bytes)?)
}
