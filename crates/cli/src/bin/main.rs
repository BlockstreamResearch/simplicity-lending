// use anyhow::Result;
// use clap::{Parser, Subcommand};

// use lending_cli::commands::asset_auth::AssetAuth;
// use lending_cli::commands::lending::Lending;
// use lending_cli::commands::pre_lock::PreLock;
// use lending_cli::commands::script_auth::ScriptAuth;
// use simplicity_contracts_cli::commands::basic::Basic;

// /// Command-line entrypoint for the Simplicity helper CLI.
// #[derive(Parser, Debug)]
// #[command(
//     name = "simplicity-lending-cli",
//     version,
//     about = "Simplicity helper Lending CLI for Liquid testnet"
// )]
// struct Cli {
//     #[command(subcommand)]
//     command: Commands,
// }

// /// Top-level subcommand groups.
// #[derive(Subcommand, Debug)]
// enum Commands {
//     /// Asset auth covenant utilities
//     AssetAuth {
//         #[command(subcommand)]
//         asset_auth: Box<AssetAuth>,
//     },
//     /// Lending covenant utilities
//     Lending {
//         #[command(subcommand)]
//         lending: Box<Lending>,
//     },
//     /// P2PK and simple transaction utilities
//     Basic {
//         #[command(subcommand)]
//         basic: Box<Basic>,
//     },
//     /// Pre lock covenant utilities
//     PreLock {
//         #[command(subcommand)]
//         pre_lock: Box<PreLock>,
//     },
//     /// Script auth covenant utilities
//     ScriptAuth {
//         #[command(subcommand)]
//         script_auth: Box<ScriptAuth>,
//     },
// }

use clap::Parser;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();

    Box::pin(lending_cli::cli::Cli::parse().run()).await?;

    Ok(())
}
