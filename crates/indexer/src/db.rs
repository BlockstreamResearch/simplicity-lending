use sqlx::{Postgres, Transaction};

pub type DbTx<'a> = Transaction<'a, Postgres>;
