/// System-random 32-byte seed.
///
/// # Panics
/// Panics if the system random number generator fails.
#[must_use]
pub fn get_random_seed() -> [u8; 32] {
    ring::rand::generate(&ring::rand::SystemRandom::new())
        .unwrap()
        .expose()
}
