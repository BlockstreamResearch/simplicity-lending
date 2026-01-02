#![warn(clippy::all, clippy::pedantic)]
extern crate core;

pub mod error;

pub mod sdk;

#[cfg(feature = "asset_auth")]
pub mod asset_auth;
