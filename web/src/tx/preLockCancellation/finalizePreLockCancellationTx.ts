/**
 * Finalize PreLock cancellation: PreLock input with cancellation signature (borrower signs sighash), ScriptAuth x4 (burn), P2PK fee.
 * Input order: 0=PreLock, 1=First params NFT, 2=Second params NFT, 3=Borrower NFT, 4=Lender NFT, 5=Fee.
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

export interface FinalizePreLockCancellationTxParams {
  pset: PsetWithExtractTx
  /** Prevouts in input order (6): PreLock, FirstParams, SecondParams, Borrower NFT, Lender NFT, Fee. */
  prevouts: EsploraVout[]
  preLockArguments: PreLockArguments
  network: 'mainnet' | 'testnet'
  /** 32-byte secret key of the borrower (creator of the offer). Signs cancellation path and fee input. */
  borrowerSecretKey: Uint8Array
}

export interface FinalizePreLockCancellationTxResult {
  signedTxHex: string
}

const NUM_INPUTS = 6

export async function finalizePreLockCancellationTx(
  params: FinalizePreLockCancellationTxParams
): Promise<FinalizePreLockCancellationTxResult> {
  const { pset, prevouts, preLockArguments, network, borrowerSecretKey } = params

  if (prevouts.length !== NUM_INPUTS) {
    throw new Error(`Expected ${NUM_INPUTS} prevouts, got ${prevouts.length}`)
  }
  if (borrowerSecretKey.length !== 32) {
    throw new Error('borrowerSecretKey must be 32 bytes')
  }

  const lwk = await getLwk()
  const { Network, Keypair, SimplicityProgram } = lwk
  const net = network === 'mainnet' ? Network.mainnet() : Network.testnet()
  const taprootUnspendableKey = getTaprootUnspendableInternalKey(lwk)

  const borrowerKeypair = new Keypair(borrowerSecretKey)
  const p2pkInternalKey = borrowerKeypair.xOnlyPublicKey()
  const p2pkArgs = buildP2pkArguments(lwk, { publicKeyHex: p2pkInternalKey.toHex() })
  const p2pkProgram = new SimplicityProgram(getSource('p2pk'), p2pkArgs)

  const preLockArgs = buildPreLockSimplicityArgs(lwk, preLockArguments)
  const preLockProgram = new SimplicityProgram(getSource('pre_lock'), preLockArgs)

  const preLockScriptHex = prevouts[0]?.scriptpubkey ?? prevouts[0]?.scriptpubkey_hex ?? ''
  if (!preLockScriptHex) {
    throw new Error('Missing preLock scriptpubkey in prevouts[0]')
  }
  const preLockInputScriptHash = await hashScriptPubkeyHex(preLockScriptHex)
  const scriptAuthArgs = buildScriptAuthArguments(lwk, { scriptHash: preLockInputScriptHash })
  const scriptAuthProgram = new SimplicityProgram(getSource('script_auth'), scriptAuthArgs)
  const scriptAuthInternalKey = getTaprootUnspendableInternalKey(lwk)
  const scriptAuthWitness = buildScriptAuthWitness(lwk, { inputScriptIndex: 0 })

  const descriptors = [
    {
      program: preLockProgram,
      internalKey: taprootUnspendableKey,
      sign: (tx: LwkTransaction, utxos: LwkTxOut[], inputIndex: number) => {
        const sighash = preLockProgram.getSighashAll(
          tx,
          taprootUnspendableKey,
          utxos,
          inputIndex,
          net
        )
        const sigHex = borrowerKeypair.signSchnorr(sighash)
        return buildPreLockWitness(lwk, {
          branch: 'PreLockCancellation',
          cancellationSignatureHex: sigHex,
        })
      },
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
      program: scriptAuthProgram,
      internalKey: scriptAuthInternalKey,
      witnessValues: scriptAuthWitness,
    },
    {
      program: p2pkProgram,
      internalKey: p2pkInternalKey,
      sign: (tx: LwkTransaction, utxos: LwkTxOut[], inputIndex: number) => {
        const sighash = p2pkProgram.getSighashAll(tx, p2pkInternalKey, utxos, inputIndex, net)
        return buildP2pkWitness(lwk, { signatureHex: borrowerKeypair.signSchnorr(sighash) })
      },
    },
  ]

  return finalizeSimplicityInputs({ pset, prevouts, network, descriptors })
}
