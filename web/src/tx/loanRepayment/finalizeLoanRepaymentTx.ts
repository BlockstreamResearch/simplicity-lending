/**
 * Finalize Loan Repayment transaction: Lending covenant (LoanRepayment branch) + 2× ScriptAuth (params NFTs) + P2PK (Borrower NFT + all principal inputs + Fee).
 * Input order: 0=Lending, 1=FirstParams NFT, 2=SecondParams NFT, 3=Borrower NFT, 4..K+3=Principal UTXOs, K+4=Fee.
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
import type { BuildLoanRepaymentTxResult } from './buildLoanRepaymentTx'

export interface FinalizeLoanRepaymentTxParams {
  pset: PsetWithExtractTx
  prevouts: EsploraVout[]
  lendingCovHash: Uint8Array
  lendingArgs: BuildLoanRepaymentTxResult['lendingArgs']
  network: 'mainnet' | 'testnet'
  borrowerSecretKey: Uint8Array
}

export interface FinalizeLoanRepaymentTxResult {
  signedTxHex: string
}

export async function finalizeLoanRepaymentTx(
  params: FinalizeLoanRepaymentTxParams
): Promise<FinalizeLoanRepaymentTxResult> {
  const { pset, prevouts, lendingCovHash, lendingArgs, network, borrowerSecretKey } = params

  if (prevouts.length < 6) {
    throw new Error(
      `Expected at least 6 prevouts (Lending, FirstParams, SecondParams, Borrower NFT, 1 principal, Fee), got ${prevouts.length}`
    )
  }
  if (borrowerSecretKey.length !== 32) {
    throw new Error('borrowerSecretKey must be 32 bytes')
  }

  const lwk = await getLwk()
  const { Network, Keypair, SimplicityProgram } = lwk
  const net = network === 'mainnet' ? Network.mainnet() : Network.testnet()
  const taprootUnspendableKey = getTaprootUnspendableInternalKey(lwk)

  const keypair = new Keypair(borrowerSecretKey)
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
  const lendingWitness = buildLendingWitness(lwk, { branch: 'LoanRepayment' })

  const scriptAuthArgs = buildScriptAuthArguments(lwk, { scriptHash: lendingCovHash })
  const scriptAuthProgram = new SimplicityProgram(getSource('script_auth'), scriptAuthArgs)
  const scriptAuthInternalKey = getTaprootUnspendableInternalKey(lwk)
  const scriptAuthWitness = buildScriptAuthWitness(lwk, { inputScriptIndex: 0 })

  const p2pkSign = (tx: LwkTransaction, utxos: LwkTxOut[], inputIndex: number) => {
    const sighash = p2pkProgram.getSighashAll(tx, p2pkInternalKey, utxos, inputIndex, net)
    return buildP2pkWitness(lwk, { signatureHex: keypair.signSchnorr(sighash) })
  }

  const numPrincipalInputs = prevouts.length - 5
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
    ...Array.from({ length: numPrincipalInputs }, () => ({
      program: p2pkProgram,
      internalKey: p2pkInternalKey,
      sign: p2pkSign,
    })),
    {
      program: p2pkProgram,
      internalKey: p2pkInternalKey,
      sign: p2pkSign,
    },
  ]

  return finalizeSimplicityInputs({ pset, prevouts, network, descriptors })
}
