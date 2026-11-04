use simplex::simplicityhl::elements::Txid;
use sqlx::{Postgres, Transaction};

pub type DbTx<'a> = Transaction<'a, Postgres>;

/// Restores a [`Txid`] from the raw 32 bytes stored in a `BYTEA` column.
///
/// The bytes are in internal order, as written by `Txid::to_byte_array`, not in the
/// reversed order used to display a txid.
pub fn txid_from_db_bytes(bytes: &[u8]) -> anyhow::Result<Txid> {
    let raw: [u8; 32] = bytes
        .try_into()
        .map_err(|e| anyhow::anyhow!("invalid txid in DB: {e}"))?;

    Ok(Txid::from_byte_array(raw))
}

#[cfg(test)]
mod tests {
    use super::txid_from_db_bytes;

    #[test]
    fn txid_from_db_bytes_round_trips_internal_byte_order() {
        let mut raw = [0_u8; 32];
        raw[0] = 0xab;
        raw[31] = 0xcd;

        let txid = txid_from_db_bytes(&raw).expect("valid txid bytes");

        assert_eq!(txid.to_byte_array(), raw);
        assert!(txid.to_string().starts_with("cd"));
        assert!(txid.to_string().ends_with("ab"));
    }

    #[test]
    fn txid_from_db_bytes_rejects_wrong_length() {
        assert!(txid_from_db_bytes(&[0_u8; 31]).is_err());
        assert!(txid_from_db_bytes(&[0_u8; 33]).is_err());
    }
}
