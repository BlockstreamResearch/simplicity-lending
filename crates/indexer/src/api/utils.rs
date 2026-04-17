pub fn format_hex(mut bytes_vec: Vec<u8>) -> String {
    bytes_vec.reverse();

    hex::encode(bytes_vec)
}

#[cfg(test)]
mod tests {
    use super::format_hex;

    #[test]
    fn format_hex_reverses_then_encodes() {
        assert_eq!(format_hex(vec![0x12, 0x34, 0xab]), "ab3412");
    }

    #[test]
    fn format_hex_empty_input_returns_empty_string() {
        assert_eq!(format_hex(vec![]), "");
    }
}
