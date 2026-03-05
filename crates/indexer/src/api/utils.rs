pub fn format_hex(mut bytes_vec: Vec<u8>) -> String {
    bytes_vec.reverse();

    hex::encode(bytes_vec)
}
