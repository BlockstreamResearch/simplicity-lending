use clap::Subcommand;
use simplicityhl::simplicity::elements::OutPoint;

#[derive(Subcommand, Debug)]
pub enum AssetAuth {
    Create {
        utxo_to_lock: OutPoint,
        fee_utxo: OutPoint,
        asset_amount: u64,
        account_index: u32,
        fee_amount: u64,
        with_asset_burn: bool,
        broadcast: bool,
    },
}
