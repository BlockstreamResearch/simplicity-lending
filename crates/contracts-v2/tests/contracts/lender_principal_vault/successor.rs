use simplex::TestContext;
use simplex::either::Either::{Left, Right};
use simplex::simplicityhl::elements::{AssetId, Script};
use simplex::transaction::{FinalTransaction, NativeSignature, PartialInput, PartialOutput, UTXO};

use lending_contracts_v2::artifacts::contracts::vault::lender_principal_vault::LenderPrincipalVaultProgram;
use lending_contracts_v2::artifacts::contracts::vault::lender_principal_vault::derived_lender_principal_vault::LenderPrincipalVaultWitness;
use lending_contracts_v2::lender_principal_vault::{
    LenderPrincipalVault, LenderPrincipalVaultParameters, LenderPrincipalVaultStorage,
};

use crate::lender_principal_vault::fixture::{Fixture, Spend, State};
use crate::support::{chain, expect, tamper};

const AMOUNT: u64 = 50_000;
const FEE: u64 = 5_000;

/// A vault holding 100 000: the lender's share of 95 000 and 5 000 of protocol fee. Every path
/// recreates it.
fn with_protocol_fee() -> State {
    State::supplied(100_000, 50_000)
}

/// A spend of one path that recreates the vault.
struct Case {
    path: &'static str,
    spend: Spend,
    /// The script of the spent vault.
    spent_script: Script,
    /// An asset other than the principal and the harvester auth.
    other_asset: AssetId,
}

impl Case {
    fn new(path: &'static str, fixture: &Fixture, spend: Spend) -> Self {
        assert!(spend.next.is_some(), "the {path} recreates the vault");

        Self {
            path,
            spend,
            spent_script: fixture.vault.get_script_pubkey(),
            other_asset: fixture.lender_nft.explicit_asset(),
        }
    }

    fn next(&self) -> &LenderPrincipalVault {
        self.spend.next.as_ref().expect("checked in Case::new")
    }

    /// The script of the recreated vault under `parameters`.
    fn next_script_with(&self, parameters: LenderPrincipalVaultParameters) -> Script {
        LenderPrincipalVault::new(
            parameters,
            self.next().get_storage(),
            *self.next().get_network(),
        )
        .get_script_pubkey()
    }

    /// Asserts that the vault rejects the spend after `edit`.
    #[track_caller]
    fn rejects_after(&self, context: &TestContext, edit: impl FnOnce(&mut FinalTransaction)) {
        println!("path: {}", self.path);

        let mut tx = self.spend.tx.clone();
        edit(&mut tx);

        expect::rejects(context, &tx, self.spend.vault_input);
    }

    /// Asserts that the vault rejects the spend after `edit` of the recreated vault output.
    #[track_caller]
    fn rejects_vault_output(&self, context: &TestContext, edit: impl FnOnce(&mut PartialOutput)) {
        let output = self.spend.vault_output();

        self.rejects_after(context, |tx| tamper::output(tx, output, edit));
    }

    /// Asserts that the vault rejects the spend when its witness points at `output` as the
    /// recreated vault.
    #[track_caller]
    fn rejects_pointing_at(
        &self,
        context: &TestContext,
        output: impl FnOnce(&mut FinalTransaction) -> usize,
    ) {
        let vault_input = self.spend.vault_input;

        self.rejects_after(context, |tx| {
            let index = u32::try_from(output(tx)).expect("a few outputs");

            tamper::witness::<LenderPrincipalVaultProgram>(tx, vault_input, |witness| {
                point_vault_output(witness, index);
            });
        });
    }
}

/// A spend of every path that recreates the vault.
fn cases(context: &TestContext) -> anyhow::Result<Vec<Case>> {
    let open = Fixture::deploy(context, with_protocol_fee())?;
    let finalized = Fixture::deploy(context, with_protocol_fee().finalized())?;

    Ok(vec![
        Case::new("supply", &open, open.supply(AMOUNT, FEE, false)),
        Case::new("final supply", &open, open.supply(AMOUNT, FEE, true)),
        Case::new(
            "partial withdrawal",
            &open,
            open.partial_withdrawal(AMOUNT / 5),
        ),
        Case::new(
            "liquidation withdrawal",
            &open,
            open.liquidation_withdrawal(),
        ),
        Case::new("harvester withdrawal", &open, open.harvester_withdrawal()),
        Case::new("full withdrawal", &finalized, finalized.full_withdrawal()),
    ])
}

/// Points the witness at `index` as the output of the recreated vault, whatever path it takes.
fn point_vault_output(witness: &mut LenderPrincipalVaultWitness, index: u32) {
    match &mut witness.path {
        Left(Left(params) | Right(params)) => params.0 = index,
        Right(Left(Left(params))) => params.0 = index,
        Right(Left(Right(params))) => params.0 = index,
        Right(Right(Left(params))) => params.0 = index,
        Right(Right(Right(params))) => params.0 = index,
    }
}

/// Asserts that the vault of `fixture` rejects a supply whose witness claims it holds `claimed`.
#[track_caller]
fn assert_rejects_claim(
    context: &TestContext,
    fixture: &mut Fixture,
    field: &str,
    claimed: LenderPrincipalVaultStorage,
    lending_offer: UTXO,
) {
    println!("field: {field}");

    let mut held_spend = fixture.supply(AMOUNT, FEE, false);

    let claimed = fixture.vault_in(claimed);
    let held = std::mem::replace(&mut fixture.vault, claimed);
    let held_offer = std::mem::replace(&mut fixture.lending_offer, lending_offer);

    let mut spend = fixture.supply(AMOUNT, FEE, false);

    fixture.vault = held;
    fixture.lending_offer = held_offer;

    // The claimed state lives in another taproot leaf, so the program comes from the held vault
    let held_program = held_spend.tx.inputs_mut()[held_spend.vault_input]
        .program_input
        .take()
        .expect("the vault input runs the vault")
        .program;
    spend.tx.inputs_mut()[spend.vault_input]
        .program_input
        .as_mut()
        .expect("the vault input runs the vault")
        .program = held_program;

    expect::rejects(context, &spend.tx, spend.vault_input);
}

/// The witness reveals the state whose hash the vault keeps, so no field can be claimed otherwise,
/// even when the rest of the spend agrees with the claim.
#[simplex::test]
fn rejects_witness_with_another_state(context: TestContext) -> anyhow::Result<()> {
    let mut open = Fixture::deploy(&context, with_protocol_fee())?;
    let held = open.vault.get_storage();
    let offer = open.lending_offer.clone();
    let nft = open.lender_nft.clone();

    let claims = [
        (
            "supplied_amount",
            LenderPrincipalVaultStorage {
                supplied_amount: held.supplied_amount + 1,
                ..held
            },
            &offer,
        ),
        (
            "supplied_fee",
            LenderPrincipalVaultStorage {
                supplied_fee: held.supplied_fee + 1,
                ..held
            },
            &offer,
        ),
        (
            "withdrawn_amount",
            LenderPrincipalVaultStorage {
                withdrawn_amount: held.withdrawn_amount + 1,
                ..held
            },
            &offer,
        ),
        (
            "withdrawn_protocol_fee",
            LenderPrincipalVaultStorage {
                withdrawn_protocol_fee: held.withdrawn_protocol_fee + 1,
                ..held
            },
            &offer,
        ),
        (
            "lender_asset_id",
            LenderPrincipalVaultStorage {
                lender_asset_id: held.lending_offer_asset_id,
                ..held
            },
            &offer,
        ),
        // The spender authorizes the supply with an asset they hold instead of the LendingOffer
        (
            "lending_offer_asset_id",
            LenderPrincipalVaultStorage {
                lending_offer_asset_id: held.lender_asset_id,
                ..held
            },
            &nft,
        ),
    ];

    for (field, claimed, lending_offer) in claims {
        assert_rejects_claim(&context, &mut open, field, claimed, lending_offer.clone());
    }

    // A finalized vault claims it is not, to be supplied to again
    let mut finalized = Fixture::deploy(&context, with_protocol_fee().finalized())?;
    let held = finalized.vault.get_storage();
    let offer = finalized.lending_offer.clone();

    assert_rejects_claim(
        &context,
        &mut finalized,
        "is_finalized",
        LenderPrincipalVaultStorage {
            is_finalized: false,
            ..held
        },
        offer,
    );

    Ok(())
}

/// The vault holds the principal, so a UTXO of another asset at its script is not a vault.
#[simplex::test]
fn rejects_vault_holding_another_asset(context: TestContext) -> anyhow::Result<()> {
    let mut fixture = Fixture::deploy(&context, with_protocol_fee())?;
    let script = fixture.vault.get_script_pubkey();
    let balance = fixture.vault_utxo.explicit_amount();

    // The same amount at the same script, but of another asset
    let asset = chain::issue_asset(&context, balance)?;
    let mut ft = FinalTransaction::new();
    ft.add_input(
        PartialInput::new(chain::signer_utxo(&context, asset)?),
        Some(NativeSignature::Ecdsa),
    );
    ft.add_output(PartialOutput::new(script.clone(), balance, asset));
    fixture.vault_utxo = chain::create(&context, &ft, &script)?;

    // A path that recreates the vault and one that may close it read the balance apart
    for spend in [
        fixture.supply(AMOUNT, FEE, false),
        fixture.harvester_withdrawal(),
    ] {
        expect::rejects(&context, &spend.tx, spend.vault_input);
    }

    Ok(())
}

#[simplex::test]
fn rejects_successor_amount_off_by_one(context: TestContext) -> anyhow::Result<()> {
    for case in cases(&context)? {
        case.rejects_vault_output(&context, |output| output.amount += 1);
        case.rejects_vault_output(&context, |output| output.amount -= 1);
    }

    Ok(())
}

#[simplex::test]
fn rejects_successor_in_another_asset(context: TestContext) -> anyhow::Result<()> {
    for case in cases(&context)? {
        let other_asset = case.other_asset;

        case.rejects_vault_output(&context, |output| output.asset = other_asset);
    }

    Ok(())
}

/// The recreated vault holds the state after the spend, not the one before it.
#[simplex::test]
fn rejects_successor_keeping_spent_state(context: TestContext) -> anyhow::Result<()> {
    for case in cases(&context)? {
        let spent_script = case.spent_script.clone();

        case.rejects_vault_output(&context, |output| output.script_pubkey = spent_script);
    }

    Ok(())
}

/// The recreated vault keeps the parameters of the protocol deployment.
#[simplex::test]
fn rejects_successor_with_other_parameters(context: TestContext) -> anyhow::Result<()> {
    for case in cases(&context)? {
        let parameters = case.next().get_parameters();

        for other in [
            LenderPrincipalVaultParameters {
                protocol_fee_rate: parameters.protocol_fee_rate + 1,
                ..parameters
            },
            LenderPrincipalVaultParameters {
                min_vault_balance: parameters.min_vault_balance + 1,
                ..parameters
            },
            LenderPrincipalVaultParameters {
                protocol_harvester_asset_id: case.other_asset,
                ..parameters
            },
        ] {
            let script = case.next_script_with(other);

            case.rejects_vault_output(&context, |output| output.script_pubkey = script);
        }
    }

    Ok(())
}

/// The recreated vault is told apart by its script: another output holding the same amount of the
/// principal is not it.
#[simplex::test]
fn rejects_witness_pointing_at_decoy_output(context: TestContext) -> anyhow::Result<()> {
    let owner = chain::signer_script(&context);

    for case in cases(&context)? {
        let vault_output = case.spend.vault_output();

        case.rejects_pointing_at(&context, |tx| {
            let mut decoy = tx.outputs()[vault_output].clone();
            decoy.script_pubkey = owner.clone();
            tx.add_output(decoy);

            tx.n_outputs() - 1
        });
    }

    Ok(())
}

#[simplex::test]
fn rejects_witness_pointing_past_outputs(context: TestContext) -> anyhow::Result<()> {
    for case in cases(&context)? {
        // Past the change output the signer adds as well
        case.rejects_pointing_at(&context, |tx| tx.n_outputs() + 5);
    }

    Ok(())
}
