#[cfg(feature = "asset_auth")]
mod asset_auth;
#[cfg(feature = "script_auth")]
mod script_auth;

#[cfg(feature = "asset_auth")]
pub use asset_auth::*;
#[cfg(feature = "script_auth")]
pub use script_auth::*;
