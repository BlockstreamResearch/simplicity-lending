use simplex::fuzz::Expect;
use simplex::fuzz::proptest::prelude::{Just, Strategy, any, prop_oneof};
use simplex::simplicityhl::elements::{AssetId, OutPoint, Script, Txid};
use simplex::transaction::UTXO;

pub fn accept_if(accepted: bool) -> Expect {
    if accepted {
        Expect::Accept
    } else {
        Expect::Reject
    }
}

/// A storage slot or witness word that is `expected` most of the time and arbitrary otherwise.
///
/// The engine generates storage on its own, so a slot the contract compares against the
/// transaction would never match and no case would be accepted.
pub fn mostly(expected: [u8; 32]) -> impl Strategy<Value = [u8; 32]> {
    prop_oneof![3 => Just(expected), 1 => any::<[u8; 32]>()]
}

/// An index that is `expected` most of the time and any index up to `bound` otherwise.
pub fn mostly_index(expected: u32, bound: u32) -> impl Strategy<Value = u32> {
    prop_oneof![3 => Just(expected), 1 => 0..=bound]
}

/// An explicit UTXO that exists only in a fuzz template. `vout` keeps the outpoints distinct.
pub fn fake_utxo(vout: u32, script: Script, amount: u64, asset: AssetId) -> UTXO {
    UTXO::explicit(
        OutPoint::new(Txid::from_byte_array([0xf0; 32]), vout),
        script,
        amount,
        asset,
    )
}

/// A P2WPKH-shaped script, distinct per `tag`.
pub fn fake_script(tag: u8) -> Script {
    let mut bytes = vec![0x00, 0x14];
    bytes.extend([tag; 20]);

    Script::from(bytes)
}

/// An asset distinct per `tag`.
pub fn fake_asset(tag: u8) -> AssetId {
    AssetId::from_byte_array([tag; 32])
}
