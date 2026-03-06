/**
 * Build (unsigned) Asset Auth Unlock transaction: spend Locked UTXO (principal at AssetAuth) + Auth UTXO (Lender NFT) + Fee.
 * Mirrors crates/contracts/src/sdk/asset_auth/unlock.rs.
 *
 * Input order: 0=Locked (principal at AssetAuth), 1=Auth (Lender NFT), 2=Fee.
 * Output order: Principal to auth script (lender), Auth burn, [fee change], fee.
 * All inputs use locktime sequence (no fallback locktime set).
 */

import type { EsploraVout } from '../../api/esplora'
import type { P2pkNetwork, PsetWithExtractTx } from '../../simplicity'
import { createPsetBuilder } from '../psetBuilder'
import { getScriptHexFromVout, bytesToHex } from '../../utility/hex'
import {
  OP_RETURN_BURN_SCRIPT_HEX,
  requireAssetHex,
  requireValue,
  normalizeAssetHex,
} from '../../utility/esploraPrevout'

export interface AssetAuthUnlockUtxo {
  outpoint: { txid: string; vout: number }
  prevout: EsploraVout
}

export interface AssetAuthArguments {
  assetId: Uint8Array
  assetAmount: number
  withAssetBurn: boolean
}

export interface BuildAssetAuthUnlockTxParams {
  lockedUtxo: AssetAuthUnlockUtxo
  authUtxo: AssetAuthUnlockUtxo
  feeUtxo: AssetAuthUnlockUtxo
  feeAmount: bigint
  assetAuthArguments: AssetAuthArguments
  network: P2pkNetwork
}

export interface BuildAssetAuthUnlockTxResult {
  pset: unknown
  unsignedTxHex: string
  prevouts: EsploraVout[]
}

export async function buildAssetAuthUnlockTx(
  params: BuildAssetAuthUnlockTxParams
): Promise<BuildAssetAuthUnlockTxResult> {
  const { lockedUtxo, authUtxo, feeUtxo, feeAmount, assetAuthArguments, network } = params

  if (feeAmount <= 0n) throw new Error('Fee amount must be at least 1')

  const lockedAssetHex = requireAssetHex(lockedUtxo.prevout, 'Locked')
  const lockedValue = requireValue(lockedUtxo.prevout, 'Locked')
  const authAssetHex = requireAssetHex(authUtxo.prevout, 'Auth')
  const authValue = requireValue(authUtxo.prevout, 'Auth')
  const feeAssetHex = requireAssetHex(feeUtxo.prevout, 'Fee')
  const feeValue = requireValue(feeUtxo.prevout, 'Fee')

  const expectedAuthAssetHex = normalizeAssetHex(
    bytesToHex(Array.from(assetAuthArguments.assetId).reverse())
  )
  if (normalizeAssetHex(authAssetHex) !== expectedAuthAssetHex) {
    throw new Error(
      `Auth UTXO asset ${authAssetHex} does not match AssetAuth arguments ${expectedAuthAssetHex}`
    )
  }
  if (authValue !== BigInt(assetAuthArguments.assetAmount)) {
    throw new Error(
      `Auth UTXO value ${authValue} does not match AssetAuth amount ${assetAuthArguments.assetAmount}`
    )
  }
  if (feeValue < feeAmount) {
    throw new Error(`Fee UTXO value ${feeValue} is less than fee ${feeAmount}`)
  }

  const networkKey: 'mainnet' | 'testnet' = network === 'mainnet' ? 'mainnet' : 'testnet'
  const api = await createPsetBuilder(networkKey)
  const policyAssetHex = api.getPolicyAssetHex()
  if (normalizeAssetHex(policyAssetHex) !== normalizeAssetHex(feeAssetHex)) {
    throw new Error('Fee UTXO must be policy asset (LBTC)')
  }

  const principalOutputScriptHex = getScriptHexFromVout(authUtxo.prevout)

  api.addInputWithLocktimeSequence(lockedUtxo.outpoint, lockedUtxo.prevout)
  api.addInputWithLocktimeSequence(authUtxo.outpoint, authUtxo.prevout)
  api.addInputWithLocktimeSequence(feeUtxo.outpoint, feeUtxo.prevout)

  api.addOutputWithScript(principalOutputScriptHex, lockedValue, lockedAssetHex)
  api.addOutputWithScript(OP_RETURN_BURN_SCRIPT_HEX, authValue, authAssetHex)

  const totalLbtcLeft = feeValue - feeAmount
  if (totalLbtcLeft > 0n) {
    api.addOutputWithScript(getScriptHexFromVout(feeUtxo.prevout), totalLbtcLeft, policyAssetHex)
  }
  api.addFeeOutput(feeAmount)

  const { pset } = api.build()
  const unsignedTxHex = (pset as PsetWithExtractTx).extractTx().toString()

  const prevouts: EsploraVout[] = [lockedUtxo.prevout, authUtxo.prevout, feeUtxo.prevout]

  return { pset, unsignedTxHex, prevouts }
}
