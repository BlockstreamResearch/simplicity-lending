use simplex::fuzz::proptest::prelude::{Strategy, any};
use simplex::fuzz::{FuzzProgramValues, Mutations, Scenario};
use simplex::provider::SimplicityNetwork;
use simplex::simplicityhl::elements::Script;
use simplex::transaction::{FinalTransaction, NativeSignature, PartialInput, PartialOutput, UTXO};
use simplex::utils::hash_script;
use simplex::{FuzzMode, TestContext};

use lending_contracts_v2::artifacts::contracts::script_auth::ScriptAuthProgram;
use lending_contracts_v2::artifacts::contracts::script_auth::derived_script_auth::{
    ScriptAuthArguments, ScriptAuthWitness,
};
use lending_contracts_v2::script_auth::{ScriptAuth, ScriptAuthStorage};

use crate::support::{chain, expect, fuzz, tamper};

const LOCKED_AMOUNT: u64 = 1_000;
const AUTH_AMOUNT: u64 = 1_000;

/// Input positions in [`Fixture::unlock`].
const LOCKED: usize = 0;
const AUTH: usize = 1;

fn script_auth_for(auth_script: &Script, network: SimplicityNetwork) -> ScriptAuth {
    ScriptAuth::new(
        ScriptAuthStorage {
            auth_script_hash: hash_script(auth_script),
        },
        network,
    )
}

/// ScriptAuth holding [`LOCKED_AMOUNT`] of the policy asset, and a UTXO to unlock it with.
struct Fixture {
    script_auth: ScriptAuth,
    locked: UTXO,
    auth: UTXO,
    /// How the auth input is signed, `None` when nobody holds its key.
    auth_signature: Option<NativeSignature>,
}

impl Fixture {
    /// On the chain: binds the contract to `auth_script` and unlocks with a signer UTXO, so
    /// `auth_script` is the signer's own in a valid unlock.
    fn deploy(context: &TestContext, auth_script: &Script) -> anyhow::Result<Self> {
        let network = *context.get_network();
        let script_auth = script_auth_for(auth_script, network);

        let mut ft = FinalTransaction::new();
        script_auth.attach_creation(&mut ft, LOCKED_AMOUNT, network.policy_asset());

        Ok(Self {
            locked: chain::create(context, &ft, &script_auth.get_script_pubkey())?,
            auth: chain::fund_signer(context, AUTH_AMOUNT)?,
            auth_signature: Some(NativeSignature::Ecdsa),
            script_auth,
        })
    }

    /// Off the chain, for fuzz templates: the same layout over UTXOs that do not exist.
    fn fake(network: SimplicityNetwork) -> Self {
        let auth_script = fuzz::fake_script(1);
        let script_auth = script_auth_for(&auth_script, network);
        let policy_asset = network.policy_asset();

        Self {
            locked: fuzz::fake_utxo(
                0,
                script_auth.get_script_pubkey(),
                LOCKED_AMOUNT,
                policy_asset,
            ),
            auth: fuzz::fake_utxo(1, auth_script, AUTH_AMOUNT, policy_asset),
            auth_signature: None,
            script_auth,
        }
    }

    /// Spends `locked` through ScriptAuth next to `auth` and pays both back to the owner of `auth`.
    fn unlock(&self) -> FinalTransaction {
        let mut ft = FinalTransaction::new();

        self.script_auth
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
    let fixture = Fixture::deploy(&context, &chain::signer_script(&context))?;

    expect::accepts(&context, &fixture.unlock())
}

#[simplex::test]
fn unlocks_when_auth_input_precedes(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, &chain::signer_script(&context))?;

    // The auth input moves to position 0 and the locked one to position 1
    let mut tx = fixture.unlock();
    tamper::swap_inputs(&mut tx, LOCKED, AUTH);
    tamper::witness::<ScriptAuthProgram>(&mut tx, 1, |witness| witness.auth_input_index = 0);

    expect::accepts(&context, &tx)
}

/// The auth input must carry the script hash kept in storage.
#[simplex::test]
fn rejects_auth_input_with_another_script(context: TestContext) -> anyhow::Result<()> {
    let stranger = context.random_signer().get_address().script_pubkey();
    let fixture = Fixture::deploy(&context, &stranger)?;

    expect::rejects(&context, &fixture.unlock(), LOCKED);

    Ok(())
}

/// The witness cannot replace the stored script hash with the spender's own.
#[simplex::test]
fn rejects_witness_claiming_another_script(context: TestContext) -> anyhow::Result<()> {
    let stranger = context.random_signer().get_address().script_pubkey();
    let fixture = Fixture::deploy(&context, &stranger)?;
    let own_script_hash = hash_script(&chain::signer_script(&context));

    let mut tx = fixture.unlock();
    tamper::witness::<ScriptAuthProgram>(&mut tx, LOCKED, |witness| {
        witness.auth_script_hash = own_script_hash;
    });

    expect::rejects(&context, &tx, LOCKED);

    Ok(())
}

/// The locked input cannot authorize itself.
#[simplex::test]
fn rejects_witness_pointing_at_locked_input(context: TestContext) -> anyhow::Result<()> {
    let fixture = Fixture::deploy(&context, &chain::signer_script(&context))?;

    let mut tx = fixture.unlock();
    tamper::witness::<ScriptAuthProgram>(&mut tx, LOCKED, |witness| {
        witness.auth_input_index = LOCKED as u32;
    });

    expect::rejects(&context, &tx, LOCKED);

    Ok(())
}

/// The values of one fuzz case: the stored hash is mostly the one of the auth input, the witness
/// mostly points at that input and claims an arbitrary stored hash.
fn unlock_values(auth_script_hash: [u8; 32]) -> impl Strategy<Value = FuzzProgramValues> {
    (
        fuzz::mostly(auth_script_hash),
        fuzz::mostly_index(AUTH as u32, 3),
        any::<[u8; 32]>(),
    )
        .prop_map(|(stored, auth_input_index, claimed)| FuzzProgramValues {
            arguments: ScriptAuthArguments::default().into(),
            witness: ScriptAuthWitness {
                auth_input_index,
                auth_script_hash: claimed,
            }
            .into(),
            storage: ScriptAuthStorage {
                auth_script_hash: stored,
            }
            .slots()
            .to_vec(),
        })
}

#[simplex::fuzz]
fn fuzz_script_auth_unlock(context: TestContext<FuzzMode>) {
    let fixture = Fixture::fake(*context.get_network());
    let auth_script_hash = hash_script(&fixture.auth.txout.script_pubkey);

    let mut scenario = Scenario::new(fixture.unlock());

    scenario
        .add::<ScriptAuthProgram>("script_auth")
        .spends(LOCKED)
        .storage_capacity(ScriptAuthStorage::SLOTS)
        .custom_strategy(unlock_values(auth_script_hash))
        // The witness carries the stored script hash, and the contract must reject any other value
        .requires_witness(|witness, case| {
            witness.auth_script_hash =
                case.program::<ScriptAuthProgram>("script_auth").storage()[0];
        });

    context
        .engine(scenario)
        .mutations(Mutations::default().layout())
        .spec(|case| {
            let script_auth = case.program::<ScriptAuthProgram>("script_auth");
            let index = script_auth.witness().auth_input_index as usize;

            // The input the witness points at must carry the stored script hash
            fuzz::accept_if(
                index < case.transaction().n_inputs()
                    && case.input_script_hash(index) == script_auth.storage()[0],
            )
        })
        .run();
}
