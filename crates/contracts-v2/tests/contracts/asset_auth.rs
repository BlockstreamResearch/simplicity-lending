use simplex::fuzz::proptest::prelude::{Strategy, any};
use simplex::fuzz::{FuzzProgramValues, Mutations, Scenario};
use simplex::provider::SimplicityNetwork;
use simplex::simplicityhl::elements::AssetId;
use simplex::transaction::{FinalTransaction, NativeSignature, PartialInput, PartialOutput, UTXO};
use simplex::{FuzzMode, TestContext};

use lending_contracts_v2::artifacts::contracts::asset_auth::AssetAuthProgram;
use lending_contracts_v2::artifacts::contracts::asset_auth::derived_asset_auth::{
    AssetAuthArguments, AssetAuthWitness,
};
use lending_contracts_v2::asset_auth::{AssetAuth, AssetAuthStorage};

use crate::support::{chain, expect, fuzz, tamper};

const LOCKED_AMOUNT: u64 = 1_000;
const AUTH_AMOUNT: u64 = 1;

/// Input positions in [`Fixture::unlock`].
const LOCKED: usize = 0;
const AUTH: usize = 1;

fn asset_auth_for(auth_asset_id: AssetId, network: SimplicityNetwork) -> AssetAuth {
    AssetAuth::new(AssetAuthStorage { auth_asset_id }, network)
}

/// AssetAuth holding [`LOCKED_AMOUNT`] of the policy asset, and a UTXO to unlock it with.
struct Fixture {
    asset_auth: AssetAuth,
    locked: UTXO,
    auth: UTXO,
    /// How the auth input is signed, `None` when nobody holds its key.
    auth_signature: Option<NativeSignature>,
}

impl Fixture {
    /// On the chain: binds the contract to `auth_asset_id` and unlocks with a signer UTXO of
    /// `held_asset_id`, which is the same asset in a valid unlock.
    fn deploy(
        context: &TestContext,
        auth_asset_id: AssetId,
        held_asset_id: AssetId,
    ) -> anyhow::Result<Self> {
        let network = *context.get_network();
        let asset_auth = asset_auth_for(auth_asset_id, network);

        let mut ft = FinalTransaction::new();
        asset_auth.attach_creation(&mut ft, LOCKED_AMOUNT, network.policy_asset());

        Ok(Self {
            locked: chain::create(context, &ft, &asset_auth.get_script_pubkey())?,
            auth: chain::signer_utxo(context, held_asset_id)?,
            auth_signature: Some(NativeSignature::Ecdsa),
            asset_auth,
        })
    }

    /// Off the chain, for fuzz templates: the same layout over UTXOs that do not exist.
    fn fake(network: SimplicityNetwork) -> Self {
        let auth_asset = fuzz::fake_asset(1);
        let asset_auth = asset_auth_for(auth_asset, network);

        Self {
            locked: fuzz::fake_utxo(
                0,
                asset_auth.get_script_pubkey(),
                LOCKED_AMOUNT,
                network.policy_asset(),
            ),
            auth: fuzz::fake_utxo(1, fuzz::fake_script(1), AUTH_AMOUNT, auth_asset),
            auth_signature: None,
            asset_auth,
        }
    }

    /// Spends `locked` through AssetAuth next to `auth` and pays both back to the owner of `auth`.
    fn unlock(&self) -> FinalTransaction {
        let mut ft = FinalTransaction::new();

        self.asset_auth
            .attach_unlocking(&mut ft, self.locked.clone(), AUTH as u32);
        ft.add_input(PartialInput::new(self.auth.clone()), self.auth_signature);

        for utxo in [&self.locked, &self.auth] {
            ft.add_output(PartialOutput::new(
                self.auth.txout.script_pubkey.clone(),
                utxo.explicit_amount(),
                utxo.explicit_asset(),
            ));
        }

        ft
    }
}

#[simplex::test]
fn unlocks_when_auth_input_follows(context: TestContext) -> anyhow::Result<()> {
    let auth_asset = chain::issue_asset(&context, AUTH_AMOUNT)?;
    let fixture = Fixture::deploy(&context, auth_asset, auth_asset)?;

    expect::accepts(&context, &fixture.unlock())
}

#[simplex::test]
fn unlocks_when_auth_input_precedes(context: TestContext) -> anyhow::Result<()> {
    let auth_asset = chain::issue_asset(&context, AUTH_AMOUNT)?;
    let fixture = Fixture::deploy(&context, auth_asset, auth_asset)?;

    // The auth input moves to position 0 and the locked one to position 1
    let mut tx = fixture.unlock();
    tamper::swap_inputs(&mut tx, LOCKED, AUTH);
    tamper::witness::<AssetAuthProgram>(&mut tx, 1, |witness| witness.auth_input_index = 0);

    expect::accepts(&context, &tx)
}

/// The auth input must hold the asset kept in storage.
#[simplex::test]
fn rejects_auth_input_with_another_asset(context: TestContext) -> anyhow::Result<()> {
    let auth_asset = chain::issue_asset(&context, AUTH_AMOUNT)?;
    let other_asset = chain::issue_asset(&context, AUTH_AMOUNT)?;
    let fixture = Fixture::deploy(&context, auth_asset, other_asset)?;

    expect::rejects(&context, &fixture.unlock(), LOCKED);

    Ok(())
}

/// The witness cannot replace the stored asset with the one the spender holds.
#[simplex::test]
fn rejects_witness_claiming_another_asset(context: TestContext) -> anyhow::Result<()> {
    let auth_asset = chain::issue_asset(&context, AUTH_AMOUNT)?;
    let other_asset = chain::issue_asset(&context, AUTH_AMOUNT)?;
    let fixture = Fixture::deploy(&context, auth_asset, other_asset)?;

    let mut tx = fixture.unlock();
    tamper::witness::<AssetAuthProgram>(&mut tx, LOCKED, |witness| {
        witness.auth_asset_id = other_asset.to_byte_array();
    });

    expect::rejects(&context, &tx, LOCKED);

    Ok(())
}

/// The locked input cannot authorize itself.
#[simplex::test]
fn rejects_witness_pointing_at_locked_input(context: TestContext) -> anyhow::Result<()> {
    let auth_asset = chain::issue_asset(&context, AUTH_AMOUNT)?;
    let fixture = Fixture::deploy(&context, auth_asset, auth_asset)?;

    let mut tx = fixture.unlock();
    tamper::witness::<AssetAuthProgram>(&mut tx, LOCKED, |witness| {
        witness.auth_input_index = LOCKED as u32;
    });

    expect::rejects(&context, &tx, LOCKED);

    Ok(())
}

/// The values of one fuzz case: the stored asset is mostly the one of the auth input, the witness
/// mostly points at that input and claims an arbitrary stored asset.
fn unlock_values(auth_asset_id: AssetId) -> impl Strategy<Value = FuzzProgramValues> {
    (
        fuzz::mostly(auth_asset_id.to_byte_array()),
        fuzz::mostly_index(AUTH as u32, 3),
        any::<[u8; 32]>(),
    )
        .prop_map(|(stored, auth_input_index, claimed)| FuzzProgramValues {
            arguments: AssetAuthArguments::default().into(),
            witness: AssetAuthWitness {
                auth_input_index,
                auth_asset_id: claimed,
            }
            .into(),
            storage: AssetAuthStorage {
                auth_asset_id: AssetId::from_byte_array(stored),
            }
            .slots()
            .to_vec(),
        })
}

#[simplex::fuzz]
fn fuzz_asset_auth_unlock(context: TestContext<FuzzMode>) {
    let fixture = Fixture::fake(*context.get_network());

    let mut scenario = Scenario::new(fixture.unlock());

    scenario
        .add::<AssetAuthProgram>("asset_auth")
        .spends(LOCKED)
        .storage_capacity(AssetAuthStorage::SLOTS)
        .custom_strategy(unlock_values(fixture.auth.explicit_asset()))
        // The witness carries the stored asset, and the contract must reject any other value
        .requires_witness(|witness, case| {
            witness.auth_asset_id = case.program::<AssetAuthProgram>("asset_auth").storage()[0];
        });

    context
        .engine(scenario)
        .mutations(Mutations::default().layout())
        .spec(|case| {
            let asset_auth = case.program::<AssetAuthProgram>("asset_auth");
            let index = asset_auth.witness().auth_input_index as usize;

            // The input the witness points at must hold the stored asset explicitly
            fuzz::accept_if(
                index < case.transaction().n_inputs()
                    && case.input_asset(index) == asset_auth.storage()[0],
            )
        })
        .run();
}
