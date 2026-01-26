use simplicity_contracts::sdk::taproot_pubkey_gen::TaprootPubkeyGen;
use simplicityhl_core::{Encodable, ProgramError, SimplicityNetwork};

use simplicityhl::simplicity::bitcoin::XOnlyPublicKey;
use simplicityhl::simplicity::elements::Address;

#[derive(Clone, Debug)]
pub struct Store {
    pub store: sled::Db,
}

impl Store {
    /// Load or create the local argument store.
    ///
    /// # Errors
    /// Returns error if the store database cannot be opened.
    pub fn load() -> anyhow::Result<Self> {
        Ok(Self {
            store: sled::open(".cache/store")?,
        })
    }

    /// Import and validate encoded arguments into the store.
    ///
    /// # Errors
    /// Returns error if hex decoding, validation, or storage fails.
    pub fn import_arguments<A>(
        &self,
        taproot_pubkey_gen: &str,
        encoded_data: &str,
        network: SimplicityNetwork,
        get_address: &impl Fn(&XOnlyPublicKey, &A, SimplicityNetwork) -> Result<Address, ProgramError>,
    ) -> anyhow::Result<()>
    where
        A: Encodable + simplicityhl_core::encoding::Decode<()>,
    {
        let decoded_data = hex::decode(encoded_data)?;

        let arguments = Encodable::decode(&decoded_data)?;
        let _ =
            TaprootPubkeyGen::build_from_str(taproot_pubkey_gen, &arguments, network, get_address)?;

        self.store.insert(taproot_pubkey_gen, decoded_data)?;

        Ok(())
    }

    /// Import and encoded arguments into the store by key.
    ///
    /// # Errors
    /// Returns error if hex decoding or storage fails.
    pub fn import_arguments_by_key(&self, key: &str, encoded_data: &str) -> anyhow::Result<()> {
        let decoded_data = hex::decode(encoded_data)?;

        self.store.insert(key, decoded_data)?;

        Ok(())
    }

    /// Export stored arguments as hex-encoded string.
    ///
    /// # Errors
    /// Returns error if arguments are not found.
    pub fn export_arguments(&self, arguments_key: &str) -> anyhow::Result<String> {
        if let Some(value) = self.store.get(arguments_key)? {
            return Ok(hex::encode(value));
        }

        anyhow::bail!("Arguments not found");
    }

    /// Retrieve and decode arguments by name.
    ///
    /// # Errors
    /// Returns error if arguments are not found or decoding fails.
    pub fn get_arguments<A>(&self, arg_name: &str) -> anyhow::Result<A>
    where
        A: Encodable + simplicityhl_core::encoding::Decode<()>,
    {
        if let Some(value) = self.store.get(arg_name)? {
            return Encodable::decode(&value).map_err(anyhow::Error::msg);
        }

        anyhow::bail!("Arguments not found");
    }
}

#[cfg(test)]
mod tests {
    use lending_contracts::asset_auth::build_arguments::AssetAuthArguments;
    use lending_contracts::asset_auth::get_asset_auth_address;
    use simplicityhl::elements::AssetId;
    use simplicityhl_core::{Encodable, LIQUID_TESTNET_TEST_ASSET_ID_STR, SimplicityNetwork};

    use super::*;

    const NETWORK: SimplicityNetwork = SimplicityNetwork::LiquidTestnet;

    fn load_mock() -> Store {
        Store {
            store: sled::Config::new()
                .temporary(true)
                .open()
                .expect("expected store"),
        }
    }

    fn get_mocked_data() -> anyhow::Result<(AssetAuthArguments, TaprootPubkeyGen)> {
        let auth_asset_id = AssetId::from_slice(&hex::decode(LIQUID_TESTNET_TEST_ASSET_ID_STR)?)?;

        let args = AssetAuthArguments::new(auth_asset_id.into_inner().0, 1, true);

        let asset_auth_taproot_pubkey_gen =
            TaprootPubkeyGen::from(&args, NETWORK, &get_asset_auth_address)?;

        Ok((args, asset_auth_taproot_pubkey_gen))
    }

    #[test]
    fn test_sled_serialize_deserialize() -> anyhow::Result<()> {
        let store = load_mock();

        let (args, asset_auth_taproot_pubkey_gen) = get_mocked_data()?;

        store.import_arguments(
            &asset_auth_taproot_pubkey_gen.to_string(),
            &args.to_hex()?,
            NETWORK,
            &get_asset_auth_address,
        )?;

        let retrieved = store
            .get_arguments::<AssetAuthArguments>(&asset_auth_taproot_pubkey_gen.to_string())?;

        assert_eq!(args, retrieved);

        Ok(())
    }

    #[test]
    fn test_sled_import_export_roundtrip() -> anyhow::Result<()> {
        let store = load_mock();

        let (args, asset_auth_taproot_pubkey_gen) = get_mocked_data()?;

        store.import_arguments(
            &asset_auth_taproot_pubkey_gen.to_string(),
            &args.to_hex()?,
            NETWORK,
            &get_asset_auth_address,
        )?;

        let exported_hex = store.export_arguments(&asset_auth_taproot_pubkey_gen.to_string())?;

        assert_eq!(exported_hex, args.to_hex()?);

        Ok(())
    }

    #[test]
    fn test_sled_export_get_consistency() -> anyhow::Result<()> {
        let store = load_mock();

        let (args, asset_auth_taproot_pubkey_gen) = get_mocked_data()?;

        store.import_arguments(
            &asset_auth_taproot_pubkey_gen.to_string(),
            &args.to_hex()?,
            NETWORK,
            &get_asset_auth_address,
        )?;

        let exported_hex = store.export_arguments(&asset_auth_taproot_pubkey_gen.to_string())?;
        let exported_bytes = hex::decode(&exported_hex)?;
        let decoded_from_export: AssetAuthArguments = Encodable::decode(&exported_bytes)?;

        let retrieved = store
            .get_arguments::<AssetAuthArguments>(&asset_auth_taproot_pubkey_gen.to_string())?;

        assert_eq!(decoded_from_export, retrieved);
        assert_eq!(retrieved, args);

        Ok(())
    }
}
