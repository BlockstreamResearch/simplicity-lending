use simplex::provider::SimplicityNetwork;
use simplex::simplicityhl::elements::Script;
use simplex::transaction::{FinalTransaction, PartialInput, PartialOutput, ProgramInput, UTXO};

use crate::artifacts::contracts::vault::lender_principal_vault::LenderPrincipalVaultProgram;
use crate::lender_principal_vault::{
    LenderPrincipalVaultError, LenderPrincipalVaultParameters, LenderPrincipalVaultStorage,
    LenderPrincipalVaultWitnessBranch,
};
use crate::utils::auth_transfer::AuthTransfer;
use crate::utils::transaction::next_output_index;

/// The vault in one state. Spending it through an `attach_*` method recreates the vault with
/// the next state, which the method returns.
pub struct LenderPrincipalVault {
    program: LenderPrincipalVaultProgram,
    parameters: LenderPrincipalVaultParameters,
    storage: LenderPrincipalVaultStorage,
    network: SimplicityNetwork,
}

impl LenderPrincipalVault {
    #[must_use]
    pub fn new(
        parameters: LenderPrincipalVaultParameters,
        storage: LenderPrincipalVaultStorage,
        network: SimplicityNetwork,
    ) -> Self {
        let mut program = LenderPrincipalVaultProgram::new(parameters.build_arguments())
            .with_storage_capacity(LenderPrincipalVaultStorage::SLOTS);

        storage.apply(&mut program);

        Self {
            program,
            parameters,
            storage,
            network,
        }
    }

    #[must_use]
    pub fn get_script_pubkey(&self) -> Script {
        self.program.get_script_pubkey(&self.network)
    }

    #[must_use]
    pub fn get_network(&self) -> &SimplicityNetwork {
        &self.network
    }

    #[must_use]
    pub fn get_parameters(&self) -> LenderPrincipalVaultParameters {
        self.parameters
    }

    #[must_use]
    pub fn get_storage(&self) -> LenderPrincipalVaultStorage {
        self.storage
    }

    /// The lender's share that is still in the vault.
    ///
    /// # Errors
    /// Returns [`LenderPrincipalVaultError::AccountingOverflow`] if the state is inconsistent.
    pub fn available_lender_shares(&self) -> Result<u64, LenderPrincipalVaultError> {
        self.storage
            .available_lender_shares(self.parameters.protocol_fee_rate)
    }

    /// The protocol fee that is still in the vault.
    ///
    /// # Errors
    /// Returns [`LenderPrincipalVaultError::AccountingOverflow`] if the state is inconsistent.
    pub fn available_protocol_fee(&self) -> Result<u64, LenderPrincipalVaultError> {
        self.storage
            .available_protocol_fee(self.parameters.protocol_fee_rate)
    }

    /// The most the lender can withdraw partially from the vault holding `balance`, or `None` when
    /// nothing can be.
    ///
    /// A partial withdrawal takes less than the lender's whole share, which only a full withdrawal
    /// takes, and leaves at least `min_vault_balance` in the vault.
    ///
    /// # Errors
    /// Returns [`LenderPrincipalVaultError::AccountingOverflow`] if the state is inconsistent.
    pub fn max_partial_withdrawal(
        &self,
        balance: u64,
    ) -> Result<Option<u64>, LenderPrincipalVaultError> {
        let below_shares = self.available_lender_shares()?.saturating_sub(1);
        let above_min_balance = balance.saturating_sub(self.parameters.min_vault_balance);

        Ok(Some(below_shares.min(above_min_balance)).filter(|&amount| amount > 0))
    }

    /// Adds the vault output holding `amount` of the principal asset.
    pub fn attach_creation(&self, ft: &mut FinalTransaction, amount: u64) {
        ft.add_output(PartialOutput::new(
            self.get_script_pubkey(),
            amount,
            self.parameters.principal_asset_id,
        ));
    }

    /// Spends `vault_utxo` to supply `amount_to_supply`, of which `fee_to_supply` is the fee, and
    /// adds the recreated vault as the next output. `finalize` marks the last supply, which burns the
    /// LendingOffer asset.
    ///
    /// # Errors
    /// Returns an error if `vault_utxo` is confidential or the vault accounting overflows.
    pub fn attach_supply(
        &self,
        ft: &mut FinalTransaction,
        vault_utxo: UTXO,
        lending_offer: AuthTransfer,
        amount_to_supply: u64,
        fee_to_supply: u64,
        finalize: bool,
    ) -> Result<Self, LenderPrincipalVaultError> {
        let new_balance = vault_balance(&vault_utxo)?
            .checked_add(amount_to_supply)
            .ok_or(LenderPrincipalVaultError::AccountingOverflow)?;
        let new_storage = self
            .storage
            .with_supply(amount_to_supply, fee_to_supply, finalize)?;

        let branch = LenderPrincipalVaultWitnessBranch::Supply {
            vault_output_index: next_output_index(ft),
            lending_offer,
            amount_to_supply,
            fee_to_supply,
            finalize,
        };

        self.attach_input(ft, vault_utxo, &branch);

        Ok(self.attach_next(ft, new_storage, new_balance))
    }

    /// Spends `vault_utxo` to pay `amount_to_withdraw` to the lender and adds the recreated vault as
    /// the next output.
    ///
    /// # Errors
    /// Returns an error if `vault_utxo` is confidential, holds less than `amount_to_withdraw` or the
    /// vault accounting overflows.
    pub fn attach_partial_withdrawal(
        &self,
        ft: &mut FinalTransaction,
        vault_utxo: UTXO,
        lender_nft: AuthTransfer,
        amount_to_withdraw: u64,
    ) -> Result<Self, LenderPrincipalVaultError> {
        let new_balance = balance_after(&vault_utxo, amount_to_withdraw)?;
        let new_storage = self
            .storage
            .with_lender_withdrawal(amount_to_withdraw, false)?;

        let branch = LenderPrincipalVaultWitnessBranch::PartialWithdrawal {
            vault_output_index: next_output_index(ft),
            lender_nft,
            amount_to_withdraw,
        };

        self.attach_input(ft, vault_utxo, &branch);

        Ok(self.attach_next(ft, new_storage, new_balance))
    }

    /// Spends `vault_utxo` to pay the lender's whole share once the vault is finalized. Adds the
    /// recreated vault as the next output unless the share is all the vault holds.
    ///
    /// # Errors
    /// Returns an error if `vault_utxo` is confidential, holds less than the share or the vault
    /// accounting overflows.
    pub fn attach_full_withdrawal(
        &self,
        ft: &mut FinalTransaction,
        vault_utxo: UTXO,
        lender_nft: AuthTransfer,
    ) -> Result<Option<Self>, LenderPrincipalVaultError> {
        let amount_to_withdraw = self.available_lender_shares()?;
        let new_storage = self
            .storage
            .with_lender_withdrawal(amount_to_withdraw, true)?;

        let branch = LenderPrincipalVaultWitnessBranch::FullWithdrawal {
            vault_output_index: next_output_index(ft),
            lender_nft,
        };

        self.attach_closing(ft, vault_utxo, &branch, amount_to_withdraw, new_storage)
    }

    /// Spends `vault_utxo` to pay the lender's whole share when the offer is liquidated. Adds the
    /// recreated vault as the next output unless the share is all the vault holds.
    ///
    /// # Errors
    /// Returns an error if `vault_utxo` is confidential, holds less than the share or the vault
    /// accounting overflows.
    pub fn attach_liquidation_withdrawal(
        &self,
        ft: &mut FinalTransaction,
        vault_utxo: UTXO,
        lending_offer: AuthTransfer,
        lender_nft: AuthTransfer,
    ) -> Result<Option<Self>, LenderPrincipalVaultError> {
        let amount_to_withdraw = self.available_lender_shares()?;
        let new_storage = self
            .storage
            .with_lender_withdrawal(amount_to_withdraw, true)?;

        let branch = LenderPrincipalVaultWitnessBranch::LiquidationWithdrawal {
            vault_output_index: next_output_index(ft),
            lending_offer,
            lender_nft,
        };

        self.attach_closing(ft, vault_utxo, &branch, amount_to_withdraw, new_storage)
    }

    /// Spends `vault_utxo` to pay all the protocol fee accumulated so far to the harvester. Adds the
    /// recreated vault as the next output unless the fee is all the vault holds.
    ///
    /// # Errors
    /// Returns an error if `vault_utxo` is confidential, holds less than the fee or the vault
    /// accounting overflows.
    pub fn attach_harvester_withdrawal(
        &self,
        ft: &mut FinalTransaction,
        vault_utxo: UTXO,
        harvester_auth: AuthTransfer,
    ) -> Result<Option<Self>, LenderPrincipalVaultError> {
        let protocol_fee_to_withdraw = self.available_protocol_fee()?;
        let new_storage = self
            .storage
            .with_protocol_fee_withdrawal(protocol_fee_to_withdraw)?;

        let branch = LenderPrincipalVaultWitnessBranch::HarvesterWithdrawal {
            vault_output_index: next_output_index(ft),
            harvester_auth,
        };

        self.attach_closing(
            ft,
            vault_utxo,
            &branch,
            protocol_fee_to_withdraw,
            new_storage,
        )
    }

    fn attach_input(
        &self,
        ft: &mut FinalTransaction,
        vault_utxo: UTXO,
        branch: &LenderPrincipalVaultWitnessBranch,
    ) {
        ft.add_program_input(
            PartialInput::new(vault_utxo),
            ProgramInput::new(
                Box::new(self.program.as_ref().clone()),
                branch.build_witness(&self.storage),
            ),
            None,
        );
    }

    /// Adds the vault with `storage` holding `balance` as the next output.
    fn attach_next(
        &self,
        ft: &mut FinalTransaction,
        storage: LenderPrincipalVaultStorage,
        balance: u64,
    ) -> Self {
        let next = Self::new(self.parameters, storage, self.network);

        next.attach_creation(ft, balance);

        next
    }

    /// The vault closes when `amount_to_withdraw` is all it holds, and is recreated otherwise.
    fn attach_closing(
        &self,
        ft: &mut FinalTransaction,
        vault_utxo: UTXO,
        branch: &LenderPrincipalVaultWitnessBranch,
        amount_to_withdraw: u64,
        new_storage: LenderPrincipalVaultStorage,
    ) -> Result<Option<Self>, LenderPrincipalVaultError> {
        let new_balance = balance_after(&vault_utxo, amount_to_withdraw)?;

        self.attach_input(ft, vault_utxo, branch);

        if new_balance == 0 {
            return Ok(None);
        }

        Ok(Some(self.attach_next(ft, new_storage, new_balance)))
    }
}

fn vault_balance(vault_utxo: &UTXO) -> Result<u64, LenderPrincipalVaultError> {
    vault_utxo
        .txout
        .value
        .explicit()
        .ok_or(LenderPrincipalVaultError::ConfidentialVaultUtxo)
}

fn balance_after(
    vault_utxo: &UTXO,
    amount_to_withdraw: u64,
) -> Result<u64, LenderPrincipalVaultError> {
    let balance = vault_balance(vault_utxo)?;

    balance
        .checked_sub(amount_to_withdraw)
        .ok_or(LenderPrincipalVaultError::InsufficientBalance {
            amount: amount_to_withdraw,
            balance,
        })
}
