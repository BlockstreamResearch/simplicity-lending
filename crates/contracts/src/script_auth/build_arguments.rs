use std::collections::HashMap;

use simplicityhl::num::U256;
use simplicityhl::{Arguments, str::WitnessName, value::UIntValue};

#[derive(Debug, Clone, bincode::Encode, bincode::Decode, PartialEq, Eq, Default)]
pub struct ScriptAuthArguments {
    pub script_hash: [u8; 32],
}

impl ScriptAuthArguments {
    #[must_use]
    pub fn new(script_hash: [u8; 32]) -> Self {
        Self { script_hash }
    }

    #[must_use]
    pub fn build_script_auth_arguments(&self) -> Arguments {
        Arguments::from(HashMap::from([(
            WitnessName::from_str_unchecked("SCRIPT_HASH"),
            simplicityhl::Value::from(UIntValue::U256(U256::from_byte_array(self.script_hash))),
        )]))
    }
}

impl simplicityhl_core::Encodable for ScriptAuthArguments {}

#[cfg(test)]
mod tests {
    use super::*;
    use simplicityhl::elements::AddressParams;
    use simplicityhl::elements::secp256k1_zkp::Secp256k1;
    use simplicityhl::simplicity::bitcoin::key::Keypair;
    use simplicityhl::simplicity::bitcoin::secp256k1;
    use simplicityhl_core::{Encodable, get_p2pk_address, hash_script};

    #[test]
    fn test_serialize_deserialize_default() -> anyhow::Result<()> {
        let args = ScriptAuthArguments::default();

        let serialized = args.encode()?;
        let deserialized = ScriptAuthArguments::decode(&serialized)?;

        assert_eq!(args, deserialized);

        Ok(())
    }

    #[test]
    fn test_serialize_deserialize_full() -> anyhow::Result<()> {
        let secp = Secp256k1::new();
        let test_sk = secp256k1::SecretKey::from_slice(&[3u8; 32])?;
        let test_kp = Keypair::from_secret_key(&secp, &test_sk);

        let test_address = get_p2pk_address(
            &test_kp.x_only_public_key().0,
            &AddressParams::LIQUID_TESTNET,
        )?;

        let args = ScriptAuthArguments {
            script_hash: hash_script(&test_address.script_pubkey()),
        };

        let serialized = args.encode()?;
        let deserialized = ScriptAuthArguments::decode(&serialized)?;

        assert_eq!(args, deserialized);

        Ok(())
    }
}
