use simplicityhl::elements::bitcoin::secp256k1;

/// The unspendable internal key specified in BIP-0341.
///
/// # Panics
///
/// This function **panics** if the hard-coded 32-byte slice is not a valid
/// x-only public key. The panic originates from
/// `secp256k1::XOnlyPublicKey::from_slice(...).expect(...)`.
/// The unspendable internal key specified in BIP-0341.
#[rustfmt::skip] // mangles byte vectors
#[must_use]
pub fn taproot_unspendable_internal_key() -> secp256k1::XOnlyPublicKey {
    secp256k1::XOnlyPublicKey::from_slice(&[
		0x50, 0x92, 0x9b, 0x74, 0xc1, 0xa0, 0x49, 0x54, 0xb7, 0x8b, 0x4b, 0x60, 0x35, 0xe9, 0x7a, 0x5e,
		0x07, 0x8a, 0x5a, 0x0f, 0x28, 0xec, 0x96, 0xd5, 0x47, 0xbf, 0xee, 0x9a, 0xce, 0x80, 0x3a, 0xc0, 
	])
	.expect("key should be valid")
}
