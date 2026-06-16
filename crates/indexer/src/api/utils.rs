pub fn format_hex(mut bytes_vec: Vec<u8>) -> String {
    bytes_vec.reverse();

    hex::encode(bytes_vec)
}

/// Decodes hex from query params using the same byte order as [`format_hex`].
pub fn parse_filter_hex(hex_str: &str) -> Option<Vec<u8>> {
    let mut bytes = hex::decode(hex_str.trim()).ok()?;
    bytes.reverse();
    Some(bytes)
}

#[cfg(test)]
mod tests {
    use super::{format_hex, parse_filter_hex};

    #[test]
    fn format_hex_reverses_then_encodes() {
        assert_eq!(format_hex(vec![0x12, 0x34, 0xab]), "ab3412");
    }

    #[test]
    fn format_hex_empty_input_returns_empty_string() {
        assert_eq!(format_hex(vec![]), "");
    }

    #[test]
    fn parse_filter_hex_roundtrips_with_format_hex() {
        let bytes: Vec<u8> = (1_u8..=32).collect();
        let hex = format_hex(bytes.clone());
        assert_eq!(parse_filter_hex(&hex), Some(bytes));
    }
}
