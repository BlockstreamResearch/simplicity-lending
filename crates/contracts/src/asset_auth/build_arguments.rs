use std::collections::HashMap;

use simplicityhl::num::U256;
use simplicityhl::{Arguments, str::WitnessName, value::UIntValue};

#[derive(Debug, Clone, bincode::Encode, bincode::Decode, PartialEq, Eq, Default)]
pub struct AssetAuthArguments {
    pub asset_id: [u8; 32],
    pub asset_amount: u64,
    pub with_asset_burn: bool,
}

impl AssetAuthArguments {
    #[must_use]
    pub fn new(asset_id: [u8; 32], asset_amount: u64, with_asset_burn: bool) -> Self {
        Self {
            asset_id,
            asset_amount,
            with_asset_burn,
        }
    }

    #[must_use]
    pub fn build_asset_auth_arguments(&self) -> Arguments {
        Arguments::from(HashMap::from([
            (
                WitnessName::from_str_unchecked("ASSET_ID"),
                simplicityhl::Value::from(UIntValue::U256(U256::from_byte_array(self.asset_id))),
            ),
            (
                WitnessName::from_str_unchecked("ASSET_AMOUNT"),
                simplicityhl::Value::from(UIntValue::U64(self.asset_amount)),
            ),
            (
                WitnessName::from_str_unchecked("WITH_ASSET_BURN"),
                simplicityhl::Value::from(self.with_asset_burn),
            ),
        ]))
    }
}

impl simplicityhl_core::Encodable for AssetAuthArguments {}

#[cfg(test)]
mod tests {
    use super::*;
    use simplicityhl::elements::AssetId;
    use simplicityhl_core::Encodable;

    #[test]
    fn test_serialize_deserialize_default() -> anyhow::Result<()> {
        let args = AssetAuthArguments::default();

        let serialized = args.encode()?;
        let deserialized = AssetAuthArguments::decode(&serialized)?;

        assert_eq!(args, deserialized);

        Ok(())
    }

    #[test]
    fn test_serialize_deserialize_full() -> anyhow::Result<()> {
        let args = AssetAuthArguments {
            asset_id: AssetId::LIQUID_BTC.into_inner().0,
            asset_amount: 1,
            with_asset_burn: true,
        };

        let serialized = args.encode()?;
        let deserialized = AssetAuthArguments::decode(&serialized)?;

        assert_eq!(args, deserialized);

        Ok(())
    }
}
