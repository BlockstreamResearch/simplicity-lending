use simplex::TestContext;
use simplex::simplicityhl::elements::AssetId;
use simplex::transaction::{FinalTransaction, NativeSignature, PartialInput, PartialOutput, UTXO};

use lending_contracts_v2::lender_principal_vault::{
    LenderPrincipalVault, LenderPrincipalVaultParameters, LenderPrincipalVaultStorage,
};
use lending_contracts_v2::utils::auth_transfer::AuthTransfer;

use crate::support::chain;

/// 10% of the supplied fee goes to the protocol.
pub const PROTOCOL_FEE_RATE: u64 = 10_000;
pub const MIN_VAULT_BALANCE: u64 = 1_000;

/// The principal the signer holds to fund the vault with.
const PRINCIPAL_AMOUNT: u64 = 1_000_000_000;
const AUTH_AMOUNT: u64 = 1;

/// The accounting part of the vault state, without the asset ids the fixture issues.
#[derive(Debug, Clone, Copy, Default)]
pub struct State {
    pub is_finalized: bool,
    pub supplied_amount: u64,
    pub supplied_fee: u64,
    pub withdrawn_amount: u64,
    pub withdrawn_protocol_fee: u64,
}

impl State {
    /// A vault `amount` was supplied to, `fee` of it being the fee.
    pub fn supplied(amount: u64, fee: u64) -> Self {
        Self {
            supplied_amount: amount,
            supplied_fee: fee,
            ..Self::default()
        }
    }

    pub fn finalized(self) -> Self {
        Self {
            is_finalized: true,
            ..self
        }
    }
}

/// Where the vault goes among the auth UTXOs of a path. The contract takes every position from
/// the witness, so any order is valid.
#[derive(Debug, Clone, Copy)]
pub enum Layout {
    VaultFirst,
    VaultLast,
}

/// A spending transaction, the vault it recreates and where the UTXOs of the path are in it.
///
/// The principal the transaction pays in or out comes after them, the payout being the last
/// output.
pub struct Spend {
    pub tx: FinalTransaction,
    /// `None` when the vault closes.
    pub next: Option<LenderPrincipalVault>,
    pub vault_input: usize,
    vault_output: Option<usize>,
    /// Where each auth UTXO moves, in the order the path names them.
    auth: Vec<AuthTransfer>,
}

impl Spend {
    pub fn vault_output(&self) -> usize {
        self.vault_output.expect("the spend recreates the vault")
    }

    pub fn auth_input(&self, auth: usize) -> usize {
        position(self.auth[auth].input_index)
    }

    pub fn auth_output(&self, auth: usize) -> usize {
        position(self.auth[auth].output_index)
    }

    /// Drops the recreated vault and pays out all of `balance` it held instead, as if the
    /// withdrawal closed the vault.
    ///
    /// # Panics
    /// Panics unless the vault output is right before the payout, which [`Layout::VaultLast`] puts
    /// there: removing it then moves no other output the witness points at.
    pub fn take_whole_balance(&mut self, balance: u64) {
        let vault_output = self.vault_output();
        assert_eq!(
            vault_output + 2,
            self.tx.n_outputs(),
            "the vault output is right before the payout"
        );

        self.tx.remove_output(vault_output);
        self.tx.outputs_mut()[vault_output].amount = balance;
        self.vault_output = None;
    }
}

/// A vault on the chain holding an issued principal asset, and the signer UTXOs of the principal,
/// the LendingOffer, the LenderNFT and the harvester auth.
pub struct Fixture {
    pub vault: LenderPrincipalVault,
    pub vault_utxo: UTXO,
    pub principal: UTXO,
    pub lending_offer: UTXO,
    pub lender_nft: UTXO,
    pub harvester_auth: UTXO,
    /// The layout of the transactions the fixture builds, [`Layout::VaultFirst`] by default.
    pub layout: Layout,
}

impl Fixture {
    /// Issues the principal and the auth assets and creates the vault in `state`, holding what its
    /// accounting says is left: the lender's share and the protocol fee.
    pub fn deploy(context: &TestContext, state: State) -> anyhow::Result<Self> {
        Self::deploy_with(context, state, None)
    }

    /// Like [`Self::deploy`], but the vault holds `balance`, which its accounting does not say. No
    /// protocol flow creates such a vault, but the contract does not check how a vault is created,
    /// so anyone can create one at the script of a real vault.
    pub fn deploy_mismatched(
        context: &TestContext,
        state: State,
        balance: u64,
    ) -> anyhow::Result<Self> {
        Self::deploy_with(context, state, Some(balance))
    }

    /// Deploys the vault holding `mismatched_balance`, or what its accounting says when `None`.
    fn deploy_with(
        context: &TestContext,
        state: State,
        mismatched_balance: Option<u64>,
    ) -> anyhow::Result<Self> {
        let principal = chain::issue_asset(context, PRINCIPAL_AMOUNT)?;
        let lending_offer = chain::issue_asset(context, AUTH_AMOUNT)?;
        let lender_nft = chain::issue_asset(context, AUTH_AMOUNT)?;
        let harvester_auth = chain::issue_asset(context, AUTH_AMOUNT)?;

        let vault = LenderPrincipalVault::new(
            LenderPrincipalVaultParameters {
                principal_asset_id: principal,
                protocol_harvester_asset_id: harvester_auth,
                protocol_fee_rate: PROTOCOL_FEE_RATE,
                min_vault_balance: MIN_VAULT_BALANCE,
            },
            storage(state, lender_nft, lending_offer),
            *context.get_network(),
        );

        let accounted = vault.available_lender_shares()? + vault.available_protocol_fee()?;
        let balance = match mismatched_balance {
            Some(balance) => {
                anyhow::ensure!(
                    balance != accounted,
                    "{balance} is what the accounting says, deploy the vault as usual"
                );
                balance
            }
            None => accounted,
        };

        let mut ft = FinalTransaction::new();
        vault.attach_creation(&mut ft, balance);
        pay_in(&mut ft, &chain::signer_utxo(context, principal)?, balance);

        Ok(Self {
            vault_utxo: chain::create(context, &ft, &vault.get_script_pubkey())?,
            principal: chain::largest_signer_utxo(context, principal)?,
            lending_offer: chain::signer_utxo(context, lending_offer)?,
            lender_nft: chain::signer_utxo(context, lender_nft)?,
            harvester_auth: chain::signer_utxo(context, harvester_auth)?,
            layout: Layout::VaultFirst,
            vault,
        })
    }

    /// Supplies `amount`, `fee` of it being the fee, next to the LendingOffer, which the final
    /// supply burns.
    pub fn supply(&self, amount: u64, fee: u64, finalize: bool) -> Spend {
        let mut spend = self.spend(&[(&self.lending_offer, finalize)], false, |tx, auth| {
            let next = self
                .vault
                .attach_supply(tx, self.vault_utxo.clone(), auth[0], amount, fee, finalize)
                .expect("the fixture supplies what fits in the vault accounting");

            Some(next)
        });

        pay_in(&mut spend.tx, &self.principal, amount);

        spend
    }

    /// Withdraws `amount` of the lender's share next to the LenderNFT, which stays with the lender,
    /// and pays it out to the signer.
    pub fn partial_withdrawal(&self, amount: u64) -> Spend {
        let mut spend = self.spend(&[(&self.lender_nft, false)], false, |tx, auth| {
            let next = self
                .vault
                .attach_partial_withdrawal(tx, self.vault_utxo.clone(), auth[0], amount)
                .expect("the fixture withdraws what the vault holds");

            Some(next)
        });

        pay_out(&mut spend.tx, &self.principal, amount);

        spend
    }

    /// Withdraws the whole lender's share, burning the LenderNFT, and pays it out to the signer.
    /// The vault closes when the share is all it holds.
    pub fn full_withdrawal(&self) -> Spend {
        let shares = self.lender_shares();
        let closes = shares == self.vault_utxo.explicit_amount();

        let mut spend = self.spend(&[(&self.lender_nft, true)], closes, |tx, auth| {
            self.vault
                .attach_full_withdrawal(tx, self.vault_utxo.clone(), auth[0])
                .expect("the fixture withdraws what the vault holds")
        });

        pay_out(&mut spend.tx, &self.principal, shares);

        spend
    }

    /// Withdraws the whole lender's share when the offer is liquidated, burning the LendingOffer and
    /// the LenderNFT, and pays it out to the signer. The vault closes when the share is all it
    /// holds.
    pub fn liquidation_withdrawal(&self) -> Spend {
        let shares = self.lender_shares();
        let closes = shares == self.vault_utxo.explicit_amount();
        let auth = [(&self.lending_offer, true), (&self.lender_nft, true)];

        let mut spend = self.spend(&auth, closes, |tx, auth| {
            self.vault
                .attach_liquidation_withdrawal(tx, self.vault_utxo.clone(), auth[0], auth[1])
                .expect("the fixture withdraws what the vault holds")
        });

        pay_out(&mut spend.tx, &self.principal, shares);

        spend
    }

    /// Withdraws all the protocol fee accumulated so far next to the harvester auth, which stays
    /// with the harvester, and pays it out to the signer. The vault closes when the fee is all it
    /// holds.
    pub fn harvester_withdrawal(&self) -> Spend {
        let fee = self
            .vault
            .available_protocol_fee()
            .expect("the fixture keeps the vault accounting consistent");
        let closes = fee == self.vault_utxo.explicit_amount();

        let mut spend = self.spend(&[(&self.harvester_auth, false)], closes, |tx, auth| {
            self.vault
                .attach_harvester_withdrawal(tx, self.vault_utxo.clone(), auth[0])
                .expect("the fixture withdraws what the vault holds")
        });

        pay_out(&mut spend.tx, &self.principal, fee);

        spend
    }

    fn lender_shares(&self) -> u64 {
        self.vault
            .available_lender_shares()
            .expect("the fixture keeps the vault accounting consistent")
    }

    /// Broadcasts `spend` and moves the fixture to the vault it recreates. The signer UTXOs that are
    /// not burned move to their new outpoints.
    pub fn apply(&mut self, context: &TestContext, spend: Spend) -> anyhow::Result<()> {
        let next = spend
            .next
            .ok_or_else(|| anyhow::anyhow!("the spend closes the vault"))?;

        self.vault_utxo = chain::create(context, &spend.tx, &next.get_script_pubkey())?;
        self.vault = next;
        self.principal = chain::largest_signer_utxo(context, self.principal.explicit_asset())?;

        for auth in [
            &mut self.lending_offer,
            &mut self.lender_nft,
            &mut self.harvester_auth,
        ] {
            if let Ok(utxo) = chain::signer_utxo(context, auth.explicit_asset()) {
                *auth = utxo;
            }
        }

        Ok(())
    }

    /// Broadcasts `spend`, which closes the vault, and checks nothing is left at the vault script.
    pub fn close(&self, context: &TestContext, spend: Spend) -> anyhow::Result<()> {
        anyhow::ensure!(spend.next.is_none(), "the spend recreates the vault");

        chain::broadcast(context, &spend.tx)?;

        let vaults = context
            .get_default_provider()
            .fetch_scripthash_utxos(&self.vault.get_script_pubkey())?;
        anyhow::ensure!(vaults.is_empty(), "the vault is closed");

        Ok(())
    }

    /// Creates another UTXO at the vault script holding the same balance. The contract does not
    /// check how a vault is created, so anyone can create one.
    pub fn duplicate(&mut self, context: &TestContext) -> anyhow::Result<UTXO> {
        let balance = self.vault_utxo.explicit_amount();

        let mut ft = FinalTransaction::new();
        self.vault.attach_creation(&mut ft, balance);
        pay_in(&mut ft, &self.principal, balance);

        let duplicate = chain::create(context, &ft, &self.vault.get_script_pubkey())?;
        self.principal = chain::largest_signer_utxo(context, self.principal.explicit_asset())?;

        Ok(duplicate)
    }

    /// The vault the fixture holds, in another state.
    pub fn vault_in(&self, storage: LenderPrincipalVaultStorage) -> LenderPrincipalVault {
        LenderPrincipalVault::new(
            self.vault.get_parameters(),
            storage,
            *self.vault.get_network(),
        )
    }

    /// Lays out the vault and the `auth` UTXOs, each moved back to its owner or burned, as
    /// [`Self::layout`] says. `attach` spends the vault with the positions of the auth UTXOs, and
    /// `closes` tells whether it recreates the vault.
    fn spend(
        &self,
        auth: &[(&UTXO, bool)],
        closes: bool,
        attach: impl FnOnce(&mut FinalTransaction, &[AuthTransfer]) -> Option<LenderPrincipalVault>,
    ) -> Spend {
        let vault_outputs = usize::from(!closes);
        let (vault_position, first_auth_input, first_auth_output) = match self.layout {
            Layout::VaultFirst => (0, 1, vault_outputs),
            Layout::VaultLast => (auth.len(), 0, 0),
        };

        let transfers: Vec<AuthTransfer> = (0..auth.len())
            .map(|index| AuthTransfer {
                input_index: index_of(first_auth_input + index),
                output_index: index_of(first_auth_output + index),
            })
            .collect();

        let mut tx = FinalTransaction::new();
        let next = match self.layout {
            Layout::VaultFirst => {
                let next = attach(&mut tx, &transfers);
                add_auth(&mut tx, auth);
                next
            }
            Layout::VaultLast => {
                add_auth(&mut tx, auth);
                attach(&mut tx, &transfers)
            }
        };

        assert_eq!(
            next.is_none(),
            closes,
            "the vault closes as the fixture expects"
        );

        Spend {
            tx,
            next,
            vault_input: vault_position,
            vault_output: (!closes).then_some(vault_position),
            auth: transfers,
        }
    }
}

fn storage(
    state: State,
    lender_nft: AssetId,
    lending_offer: AssetId,
) -> LenderPrincipalVaultStorage {
    LenderPrincipalVaultStorage {
        is_finalized: state.is_finalized,
        supplied_amount: state.supplied_amount,
        supplied_fee: state.supplied_fee,
        withdrawn_amount: state.withdrawn_amount,
        withdrawn_protocol_fee: state.withdrawn_protocol_fee,
        lender_asset_id: lender_nft,
        lending_offer_asset_id: lending_offer,
    }
}

/// Adds the `auth` UTXOs as inputs and their outputs: back to the owner, or burned.
fn add_auth(tx: &mut FinalTransaction, auth: &[(&UTXO, bool)]) {
    for &(utxo, burn) in auth {
        let script = if burn {
            chain::burn_script()
        } else {
            utxo.txout.script_pubkey.clone()
        };

        tx.add_input(
            PartialInput::new(utxo.clone()),
            Some(NativeSignature::Ecdsa),
        );
        tx.add_output(PartialOutput::new(
            script,
            utxo.explicit_amount(),
            utxo.explicit_asset(),
        ));
    }
}

/// Pays `amount` into the transaction from the signer's `principal`, with the change back to it.
fn pay_in(tx: &mut FinalTransaction, principal: &UTXO, amount: u64) {
    let change = principal
        .explicit_amount()
        .checked_sub(amount)
        .expect("the signer holds enough principal");

    tx.add_input(
        PartialInput::new(principal.clone()),
        Some(NativeSignature::Ecdsa),
    );

    if change > 0 {
        tx.add_output(PartialOutput::new(
            principal.txout.script_pubkey.clone(),
            change,
            principal.explicit_asset(),
        ));
    }
}

/// Pays `amount` out of the transaction to the owner of the signer's `principal`.
fn pay_out(tx: &mut FinalTransaction, principal: &UTXO, amount: u64) {
    if amount > 0 {
        tx.add_output(PartialOutput::new(
            principal.txout.script_pubkey.clone(),
            amount,
            principal.explicit_asset(),
        ));
    }
}

fn index_of(position: usize) -> u32 {
    u32::try_from(position).expect("a few inputs and outputs")
}

fn position(index: u32) -> usize {
    usize::try_from(index).expect("u32 fits in usize")
}
