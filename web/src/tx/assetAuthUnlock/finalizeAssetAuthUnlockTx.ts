/**
 * Finalize Asset Auth Unlock transaction: AssetAuth covenant (input 0) + P2PK (Auth input 1, Fee input 2).
 * Input order: 0=Locked, 1=Auth (Lender NFT), 2=Fee.
 */

import type { EsploraVout } from '../../api/esplora'
import type { LwkTransaction, LwkTxOut, PsetWithExtractTx } from '../../simplicity'
import { getLwk, getSource } from '../../simplicity'
import { finalizeSimplicityInputs } from '../../simplicity/finalizeSimplicityInputs'
import {
  buildP2pkArguments,
  buildP2pkWitness,
  buildAssetAuthArguments,
  buildAssetAuthWitness,
} from '../../simplicity/covenants'
import { getTaprootUnspendableInternalKey } from '../../utility/taprootUnspendableKey'
import type { AssetAuthArguments } from './buildAssetAuthUnlockTx'

export interface FinalizeAssetAuthUnlockTxParams {
  pset: PsetWithExtractTx
  prevouts: EsploraVout[]
  assetAuthArguments: AssetAuthArguments
  network: 'mainnet' | 'testnet'
  lenderSecretKey: Uint8Array
}

export interface FinalizeAssetAuthUnlockTxResult {
  signedTxHex: string
}

const NUM_INPUTS = 3

export async function finalizeAssetAuthUnlockTx(
  params: FinalizeAssetAuthUnlockTxParams
): Promise<FinalizeAssetAuthUnlockTxResult> {
  const { pset, prevouts, assetAuthArguments, network, lenderSecretKey } = params

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

  const assetAuthArgsLwk = buildAssetAuthArguments(lwk, {
    assetId: assetAuthArguments.assetId,
    assetAmount: assetAuthArguments.assetAmount,
    withAssetBurn: assetAuthArguments.withAssetBurn,
  })
  const assetAuthProgram = SimplicityProgram.load(getSource('asset_auth'), assetAuthArgsLwk)
  const assetAuthWitness = buildAssetAuthWitness(lwk, {
    inputAssetIndex: 1,
    outputAssetIndex: 1,
  })

  const p2pkSign = (tx: LwkTransaction, utxos: LwkTxOut[], inputIndex: number) => {
    const sighash = p2pkProgram.getSighashAll(tx, p2pkInternalKey, utxos, inputIndex, net)
    return buildP2pkWitness(lwk, { signatureHex: keypair.signSchnorr(sighash) })
  }

  const descriptors = [
    {
      program: assetAuthProgram,
      internalKey: taprootUnspendableKey,
      witnessValues: assetAuthWitness,
    },
    {
      program: p2pkProgram,
      internalKey: p2pkInternalKey,
      sign: p2pkSign,
    },
    {
      program: p2pkProgram,
      internalKey: p2pkInternalKey,
      sign: p2pkSign,
    },
  ]

  return finalizeSimplicityInputs({ pset, prevouts, network, descriptors })
}
