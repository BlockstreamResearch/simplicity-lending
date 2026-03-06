/**
 * Finalize Loan Liquidation transaction: Lending covenant (liquidation branch) + 2× ScriptAuth (params NFTs) + P2PK (Lender NFT + Fee).
 * Input order: 0=Lending, 1=FirstParams NFT, 2=SecondParams NFT, 3=Lender NFT, 4=Fee.
 * Lender NFT (3) is owned by the user and spent with P2PK like Fee (4).
 */

import type { EsploraVout } from '../../api/esplora'
import type { LwkTransaction, LwkTxOut, PsetWithExtractTx } from '../../simplicity'
import { getLwk, getSource } from '../../simplicity'
import { finalizeSimplicityInputs } from '../../simplicity/finalizeSimplicityInputs'
import {
  buildP2pkArguments,
  buildP2pkWitness,
  buildScriptAuthArguments,
  buildScriptAuthWitness,
  buildLendingArguments,
  buildLendingWitness,
} from '../../simplicity/covenants'
import { getTaprootUnspendableInternalKey } from '../../utility/taprootUnspendableKey'
import type { BuildLoanLiquidationTxResult } from './buildLoanLiquidationTx'

export interface FinalizeLoanLiquidationTxParams {
  pset: PsetWithExtractTx
  prevouts: EsploraVout[]
  lendingCovHash: Uint8Array
  lendingArgs: BuildLoanLiquidationTxResult['lendingArgs']
  network: 'mainnet' | 'testnet'
  lenderSecretKey: Uint8Array
}

export interface FinalizeLoanLiquidationTxResult {
  signedTxHex: string
}

const NUM_INPUTS = 5

export async function finalizeLoanLiquidationTx(
  params: FinalizeLoanLiquidationTxParams
): Promise<FinalizeLoanLiquidationTxResult> {
  const { pset, prevouts, lendingCovHash, lendingArgs, network, lenderSecretKey } = params

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

  const keypair = new Keypair(lenderSecretKey)
  const p2pkInternalKey = keypair.xOnlyPublicKey()
  const p2pkArgs = buildP2pkArguments(lwk, { publicKeyHex: p2pkInternalKey.toHex() })
  const p2pkProgram = new SimplicityProgram(getSource('p2pk'), p2pkArgs)

  const lendingArgsLwk = buildLendingArguments(lwk, {
    collateralAssetId: lendingArgs.collateralAssetId,
    principalAssetId: lendingArgs.principalAssetId,
    borrowerNftAssetId: lendingArgs.borrowerNftAssetId,
    lenderNftAssetId: lendingArgs.lenderNftAssetId,
    firstParametersNftAssetId: lendingArgs.firstParametersNftAssetId,
    secondParametersNftAssetId: lendingArgs.secondParametersNftAssetId,
    lenderPrincipalCovHash: lendingArgs.lenderPrincipalCovHash,
    lendingParams: lendingArgs.lendingParams,
  })
  const lendingProgram = new SimplicityProgram(getSource('lending'), lendingArgsLwk)
  const lendingWitness = buildLendingWitness(lwk, { branch: 'LoanLiquidation' })

  const scriptAuthArgs = buildScriptAuthArguments(lwk, { scriptHash: lendingCovHash })
  const scriptAuthProgram = new SimplicityProgram(getSource('script_auth'), scriptAuthArgs)
  const scriptAuthInternalKey = getTaprootUnspendableInternalKey(lwk)
  const scriptAuthWitness = buildScriptAuthWitness(lwk, { inputScriptIndex: 0 })

  const p2pkSign = (tx: LwkTransaction, utxos: LwkTxOut[], inputIndex: number) => {
    const sighash = p2pkProgram.getSighashAll(tx, p2pkInternalKey, utxos, inputIndex, net)
    return buildP2pkWitness(lwk, { signatureHex: keypair.signSchnorr(sighash) })
  }

  const descriptors = [
    {
      program: lendingProgram,
      internalKey: taprootUnspendableKey,
      witnessValues: lendingWitness,
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
