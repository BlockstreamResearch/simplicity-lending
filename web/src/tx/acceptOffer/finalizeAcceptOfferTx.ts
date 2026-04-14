/**
 * Finalize Accept Offer transaction: satisfy covenant inputs (PreLock, ScriptAuth) and sign P2PK inputs.
 * Input order: 0=PreLock, 1=First params NFT, 2=Second params NFT, 3=Borrower NFT, 4=Lender NFT, 5=Principal, 6=Fee.
 * Uses finalizeSimplicityInputs with a descriptor per input.
 */

import type { EsploraVout } from '../../api/esplora'
import { hashScriptPubkeyHex } from '../../api/esplora'
import type { LwkTransaction, LwkTxOut, PsetWithExtractTx } from '../../simplicity'
import { getLwk, getSource } from '../../simplicity'
import { finalizeSimplicityInputs } from '../../simplicity/finalizeSimplicityInputs'
import type { PreLockArguments } from '../../utility/preLockArguments'
import {
  buildP2pkArguments,
  buildP2pkWitness,
  buildScriptAuthArguments,
  buildPreLockArguments as buildPreLockSimplicityArgs,
  buildPreLockWitness,
  buildScriptAuthWitness,
} from '../../simplicity/covenants'
import { getTaprootUnspendableInternalKey } from '../../utility/taprootUnspendableKey'

export interface FinalizeAcceptOfferTxParams {
  pset: PsetWithExtractTx
  /** Prevouts in input order (7): PreLock, FirstParams, SecondParams, BorrowerNFT, LenderNFT, Principal, Fee. */
  prevouts: EsploraVout[]
  preLockArguments: PreLockArguments
  lendingCovHash: Uint8Array
  network: 'mainnet' | 'testnet'
  /** 32-byte secret key for P2PK inputs (Principal and Fee). */
  lenderSecretKey: Uint8Array
}

export interface FinalizeAcceptOfferTxResult {
  signedTxHex: string
}

const NUM_INPUTS = 7

export async function finalizeAcceptOfferTx(
  params: FinalizeAcceptOfferTxParams
): Promise<FinalizeAcceptOfferTxResult> {
  const { pset, prevouts, preLockArguments, network, lenderSecretKey } = params

  if (prevouts.length !== NUM_INPUTS) {
    throw new Error(`Expected ${NUM_INPUTS} prevouts, got ${prevouts.length}`)
  }
  if (lenderSecretKey.length !== 32) {
    throw new Error('lenderSecretKey must be 32 bytes')
  }

  const lwk = await getLwk()
  const { Network, Keypair, SimplicityProgram } = lwk
  const net = network === 'mainnet' ? Network.mainnet() : Network.testnet()
  const taprootUnspendableKey = getTaprootUnspendableInternalKey(lwk)

  const keypair = Keypair.fromSecretBytes(lenderSecretKey)
  const p2pkInternalKey = keypair.xOnlyPublicKey
  const p2pkArgs = buildP2pkArguments(lwk, { publicKeyHex: p2pkInternalKey.toString() })
  const p2pkProgram = SimplicityProgram.load(getSource('p2pk'), p2pkArgs)

  const preLockArgs = buildPreLockSimplicityArgs(lwk, preLockArguments)
  const preLockProgram = SimplicityProgram.load(getSource('pre_lock'), preLockArgs)
  const preLockWitness = buildPreLockWitness(lwk, { branch: 'LendingCreation' })

  const preLockScriptHex = prevouts[0]?.scriptpubkey ?? prevouts[0]?.scriptpubkey_hex ?? ''
  if (!preLockScriptHex) {
    throw new Error('Missing preLock scriptpubkey in prevouts[0]')
  }
  const preLockInputScriptHash = await hashScriptPubkeyHex(preLockScriptHex)
  const scriptAuthArgs = buildScriptAuthArguments(lwk, { scriptHash: preLockInputScriptHash })
  const scriptAuthProgram = SimplicityProgram.load(getSource('script_auth'), scriptAuthArgs)
  const scriptAuthInternalKey = getTaprootUnspendableInternalKey(lwk)
  const scriptAuthWitness = buildScriptAuthWitness(lwk, { inputScriptIndex: 0 })

  const descriptors = [
    { program: preLockProgram, internalKey: taprootUnspendableKey, witnessValues: preLockWitness },
    {
      program: scriptAuthProgram,
      internalKey: scriptAuthInternalKey,
      witnessValues: scriptAuthWitness,
    },
    {
      program: scriptAuthProgram,
      internalKey: scriptAuthInternalKey,
      witnessValues: scriptAuthWitness,
    },
    {
      program: scriptAuthProgram,
      internalKey: scriptAuthInternalKey,
      witnessValues: scriptAuthWitness,
    },
    {
      program: scriptAuthProgram,
      internalKey: scriptAuthInternalKey,
      witnessValues: scriptAuthWitness,
    },
    {
      program: p2pkProgram,
      internalKey: p2pkInternalKey,
      sign: (tx: LwkTransaction, utxos: LwkTxOut[], inputIndex: number) => {
        const sighash = p2pkProgram.getSighashAll(tx, p2pkInternalKey, utxos, inputIndex, net)
        return buildP2pkWitness(lwk, { signatureHex: keypair.signSchnorr(sighash) })
      },
    },
    {
      program: p2pkProgram,
      internalKey: p2pkInternalKey,
      sign: (tx: LwkTransaction, utxos: LwkTxOut[], inputIndex: number) => {
        const sighash = p2pkProgram.getSighashAll(tx, p2pkInternalKey, utxos, inputIndex, net)
        return buildP2pkWitness(lwk, { signatureHex: keypair.signSchnorr(sighash) })
      },
    },
  ]

  return finalizeSimplicityInputs({ pset, prevouts, network, descriptors })
}
