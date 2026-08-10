use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};
use lending_contracts::artifacts::{
    asset_auth::AssetAuthProgram, asset_auth_vault::AssetAuthVaultProgram,
    issuance_factory::IssuanceFactoryProgram, lending::LendingProgram,
    script_auth::ScriptAuthProgram,
};

const OUTPUT_FILE_NAME: &str = "contract_sources.json";

fn main() -> Result<()> {
    let sources: BTreeMap<&'static str, &'static str> = BTreeMap::from([
        ("asset_auth", AssetAuthProgram::SOURCE),
        ("asset_auth_vault", AssetAuthVaultProgram::SOURCE),
        ("issuance_factory", IssuanceFactoryProgram::SOURCE),
        ("lending", LendingProgram::SOURCE),
        ("script_auth", ScriptAuthProgram::SOURCE),
    ]);

    let out_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(OUTPUT_FILE_NAME);
    let json = serde_json::to_string_pretty(&sources).context("failed to serialize sources")?;
    let new_contents = format!("{json}\n");

    let previous = fs::read_to_string(&out_path).ok();
    if previous.as_deref() == Some(new_contents.as_str()) {
        println!("Unchanged {}", out_path.display());
        return Ok(());
    }

    fs::write(&out_path, &new_contents)
        .with_context(|| format!("failed to write {}", out_path.display()))?;

    if previous.is_some() {
        println!("Updated {}", out_path.display());
    } else {
        println!("Created {}", out_path.display());
    }
    Ok(())
}
