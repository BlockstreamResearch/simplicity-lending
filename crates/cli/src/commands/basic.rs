use crate::modules::utils::derive_keypair;

use simplicity_contracts::sdk::transfer_native;

use crate::commands::NETWORK;
use crate::explorer::{broadcast_tx, fetch_utxo};

use clap::Subcommand;
use simplicityhl::elements::pset::serialize::Serialize;
use simplicityhl::simplicity::elements::{Address, OutPoint};
use simplicityhl::simplicity::hex::DisplayHex;

use simplicityhl::tracker::TrackerLogLevel;
use simplicityhl_core::{
    create_p2pk_signature, finalize_p2pk_transaction, get_p2pk_address, hash_script,
};

#[derive(Subcommand, Debug)]
pub enum Basic {
    /// Print a deterministic Liquid testnet address derived from index
    Address {
        /// Address index (0-based)
        index: u32,
    },
    /// Build tx transferring LBTC (explicit) to recipient
    TransferNative {
        /// Transaction id (hex) and output index (vout) of the UTXO you will spend
        #[arg(long = "utxo")]
        utxo_outpoint: OutPoint,
        /// Recipient address (Liquid testnet bech32m)
        #[arg(long = "to-address")]
        to_address: Address,
        /// Amount to send to the recipient in satoshis (LBTC)
        #[arg(long = "send-sats")]
        amount_to_send: u64,
        /// Miner fee in satoshis (LBTC)
        #[arg(long = "fee-sats")]
        fee_amount: u64,
        /// Account that will pay for transaction fees and that owns a tokens to send
        #[arg(long = "account-index", default_value_t = 0)]
        account_index: u32,
        /// When set, broadcast the built transaction via Esplora and print txid
        #[arg(long = "broadcast")]
        broadcast: bool,
    },
}

impl Basic {
    /// Handle basic CLI subcommand execution.
    ///
    /// # Errors
    /// Returns error if the subcommand operation fails.
    ///
    /// # Panics
    /// Panics if asset entropy conversion fails.
    pub async fn handle(&self) -> anyhow::Result<()> {
        match self {
            Self::Address { index } => {
                let keypair = derive_keypair(*index);

                let public_key = keypair.x_only_public_key().0;
                let address = get_p2pk_address(&public_key, NETWORK)?;

                let mut script_hash: [u8; 32] = hash_script(&address.script_pubkey());
                script_hash.reverse();

                println!("X Only Public Key: {public_key}");
                println!("P2PK Address: {address}");
                println!("Script hash: {}", hex::encode(script_hash));

                Ok(())
            }
            Self::TransferNative {
                utxo_outpoint,
                to_address,
                amount_to_send,
                fee_amount,
                account_index,
                broadcast,
            } => {
                let keypair = derive_keypair(*account_index);

                let tx_out = fetch_utxo(*utxo_outpoint).await?;

                let pst = transfer_native(
                    (*utxo_outpoint, tx_out.clone()),
                    to_address,
                    *amount_to_send,
                    *fee_amount,
                )?;

                let tx = pst.extract_tx()?;
                let utxos = &[tx_out];

                let x_only_public_key = keypair.x_only_public_key().0;
                let signature = create_p2pk_signature(&tx, utxos, &keypair, 0, NETWORK)?;

                let tx = finalize_p2pk_transaction(
                    tx,
                    utxos,
                    &x_only_public_key,
                    &signature,
                    0,
                    NETWORK,
                    TrackerLogLevel::None,
                )?;

                if *broadcast {
                    println!("Broadcasted txid: {}", broadcast_tx(&tx).await?);
                } else {
                    println!("{}", tx.serialize().to_lower_hex_string());
                }

                Ok(())
            }
        }
    }
}
