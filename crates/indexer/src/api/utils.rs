pub fn format_hex(mut bytes_vec: Vec<u8>) -> String {
    bytes_vec.reverse();

    hex::encode(bytes_vec)
}

/// Formats a satoshi amount for API responses (decimal string).
pub fn format_satoshis(amount: i64) -> String {
    amount.to_string()
}

/// Decodes hex from query params using the same byte order as [`format_hex`].
pub fn parse_filter_hex(hex_str: &str) -> Option<Vec<u8>> {
    let mut bytes = hex::decode(hex_str.trim()).ok()?;
    bytes.reverse();
    Some(bytes)
}

/// Decodes a wallet `script_pubkey` query value from hex.
pub fn parse_script_pubkey(hex_str: &str) -> Result<Vec<u8>, crate::api::ApiError> {
    hex::decode(hex_str.trim())
        .map_err(|_| crate::api::ApiError::BadRequest("Invalid script_pubkey hex".to_string()))
}

#[cfg(test)]
mod tests {
    use super::{format_hex, format_satoshis, parse_filter_hex, parse_script_pubkey};

    #[test]
    fn format_hex_reverses_then_encodes() {
        assert_eq!(format_hex(vec![0x12, 0x34, 0xab]), "ab3412");
    }

    #[test]
    fn format_hex_empty_input_returns_empty_string() {
        assert_eq!(format_hex(vec![]), "");
    }

    #[test]
    fn format_satoshis_serializes_as_decimal_string() {
        assert_eq!(format_satoshis(1_000), "1000");
        assert_eq!(format_satoshis(0), "0");
    }

    #[test]
    fn parse_script_pubkey_decodes_hex() {
        assert_eq!(parse_script_pubkey("52ac").expect("hex"), vec![0x52, 0xac]);
    }

    #[test]
    fn parse_script_pubkey_rejects_invalid_hex() {
        assert!(parse_script_pubkey("zzzz").is_err());
    }

    #[test]
    fn parse_filter_hex_roundtrips_with_format_hex() {
        let bytes: Vec<u8> = (1_u8..=32).collect();
        let hex = format_hex(bytes.clone());
        assert_eq!(parse_filter_hex(&hex), Some(bytes));
    }
}
