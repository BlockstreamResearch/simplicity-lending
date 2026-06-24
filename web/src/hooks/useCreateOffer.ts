import {
  Address,
  AssetId,
  assetIdFromIssuance,
  ContractHash,
  ExternalUtxo,
  IssuanceRecipient,
  OutPoint,
  Script,
  SimplicityLogLevel,
  TxBuilder,
  TxOutSecrets,
  XOnlyPublicKey,
} from 'lwk_web'

import { fetchFeeRateSatPerKvb } from '@/api/esplora/fee'
import { broadcastTx, fetchLatestBlockHeight } from '@/api/esplora/methods'
import {
  assertExplicitAmount,
  fetchTransaction,
  requireExplicitAsset,
  requireTxOut,
} from '@/lwk/transaction'
import {
  assertWalletUtxoAssetAndMinimumAmount,
  EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
  requireWalletUtxo,
} from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import {
  buildIssuanceFactoryWitness,
  ISSUANCE_FACTORY_MAX_WEIGHT_TO_SATISFY,
  loadIssuanceFactoryProgram,
} from '@/simplicity/issuance-factory/program'
import { encodePendingOfferMetadata } from '@/simplicity/lending/metadata'
import {
  buildDerivedLendingOfferProgramParams,
  buildLendingOfferSpendInfo,
  loadLendingProgram,
} from '@/simplicity/lending/program'
import { loadScriptAuthProgram } from '@/simplicity/script-auth/program'
import { buildCovenantSpendInfo, UNSPENDABLE_TAPROOT_PUBKEY } from '@/simplicity/taproot'
import { bytesToHex, hexToBytes } from '@/utils/hex'
import { toBytes32, toUint8, toUint16, toUint32, toUint64 } from '@/utils/uint'

const ISSUING_UTXOS_COUNT = 2
const REISSUANCE_FLAGS = 0n
const REISSUANCE_TOKEN_AMOUNT = 0n
const NFT_AMOUNT = 1n
const MAX_PRINCIPAL_INTEREST_RATE_BPS = 65_535

export interface CreateOfferParams {
  factoryAuthOutpoint: string
  issuanceFactoryOutpoint: string
  factoryAssetId: string
  collateralOutpoints: string[]
  collateralAmount: bigint
  principalAssetId: string
  principalAmount: bigint
  principalInterestRate: number
  loanDurationBlocks: number
  protocolFeeKeeperAssetId: string
}

export interface CreateOfferResult {
  txid: string
  summary: {
    inputs: Record<string, string>
    outputs: Record<string, string>
    assetIds: Record<string, string>
    scripts: Record<string, string>
    offerParameters: Record<string, string>
    metadataOpReturnHex: string
  }
}

export function useCreateOffer() {
  const { lwkNetwork } = useLwk()
  const { getReceiveAddress, getBlindedWalletUtxos, getWollet, signPset, syncWallet } = useWallet()

  const createOffer = async (params: CreateOfferParams): Promise<CreateOfferResult> => {
    const [receiveAddressString, wollet] = await Promise.all([getReceiveAddress(), getWollet()])
    if (!receiveAddressString) throw new Error('Missing receive address')
    await syncWallet()
    const blindedWalletUtxos = await getBlindedWalletUtxos()
    if (params.collateralOutpoints.length === 0) {
      throw new Error('At least one collateral UTXO is required')
    }
    if (new Set(params.collateralOutpoints).size !== params.collateralOutpoints.length) {
      throw new Error('Collateral UTXO list contains duplicates')
    }
    const collateralUtxos = params.collateralOutpoints.map(outpoint =>
      requireWalletUtxo(blindedWalletUtxos, outpoint, 'Collateral'),
    )
    const factoryAssetString = params.factoryAssetId
    const principalAssetString = params.principalAssetId
    const protocolFeeKeeperAssetString = params.protocolFeeKeeperAssetId
    const policyAssetString = lwkNetwork.policyAsset().toString()

    let collateralInputAmount = 0n
    for (const collateralUtxo of collateralUtxos) {
      assertWalletUtxoAssetAndMinimumAmount(collateralUtxo, policyAssetString, 1n, 'Collateral')
      collateralInputAmount += collateralUtxo.unblinded().value()
    }
    if (collateralInputAmount < params.collateralAmount) {
      throw new Error('Collateral UTXO amount is lower than required collateral amount')
    }
    if (collateralInputAmount === params.collateralAmount) {
      throw new Error('Collateral input total must exceed collateral amount to leave fees')
    }

    const factoryAuthOutpoint = new OutPoint(params.factoryAuthOutpoint)
    const issuanceFactoryOutpoint = new OutPoint(params.issuanceFactoryOutpoint)
    const lenderNftIssuanceOutpointString = params.collateralOutpoints[0]
    if (!lenderNftIssuanceOutpointString) {
      throw new Error('At least one collateral UTXO is required')
    }
    const collateralOutpoints = params.collateralOutpoints.map(outpoint => new OutPoint(outpoint))
    const lenderNftIssuanceOutpoint = new OutPoint(lenderNftIssuanceOutpointString)
    const [factoryAuthTx, issuanceFactoryTx, collateralTxs, currentBlockHeight, feeRate] =
      await Promise.all([
        fetchTransaction(factoryAuthOutpoint),
        fetchTransaction(issuanceFactoryOutpoint),
        Promise.all(collateralOutpoints.map(outpoint => fetchTransaction(outpoint))),
        fetchLatestBlockHeight(),
        fetchFeeRateSatPerKvb(),
      ])
    const factoryAuthTxOut = requireTxOut(factoryAuthTx, factoryAuthOutpoint.vout(), 'FactoryAuth')
    const issuanceFactoryTxOut = requireTxOut(
      issuanceFactoryTx,
      issuanceFactoryOutpoint.vout(),
      'IssuanceFactory',
    )
    const collateralTxOuts = collateralTxs.map((tx, index) => {
      const outpoint = collateralOutpoints[index]
      if (!outpoint) throw new Error('Missing collateral outpoint for fetched transaction')
      return requireTxOut(tx, outpoint.vout(), 'Collateral')
    })

    if (requireExplicitAsset(factoryAuthTxOut, 'FactoryAuth').toString() !== factoryAssetString) {
      throw new Error('FactoryAuth UTXO has unexpected asset')
    }
    assertExplicitAmount(factoryAuthTxOut, NFT_AMOUNT, 'FactoryAuth')
    const receiveAddressExplicitString = Address.parse(receiveAddressString, lwkNetwork)
      .toUnconfidential()
      .toString()
    const issuanceFactoryProgram = loadIssuanceFactoryProgram({
      issuingUtxosCount: toUint8(ISSUING_UTXOS_COUNT, 'issuingUtxosCount'),
      reissuanceFlags: toUint64(REISSUANCE_FLAGS, 'reissuanceFlags'),
    })
    const issuanceFactoryAddress = issuanceFactoryProgram.createP2trAddress(
      XOnlyPublicKey.fromString(UNSPENDABLE_TAPROOT_PUBKEY),
      lwkNetwork,
    )
    const issuanceFactoryAddressString = issuanceFactoryAddress.toString()

    const issuanceFactoryExternalUtxo = new ExternalUtxo(
      issuanceFactoryOutpoint.vout(),
      issuanceFactoryTx,
      TxOutSecrets.fromExplicit(AssetId.fromString(factoryAssetString), NFT_AMOUNT),
      ISSUANCE_FACTORY_MAX_WEIGHT_TO_SATISFY.IssueAssets,
      true,
    )
    const factoryAuthExternalUtxo = new ExternalUtxo(
      factoryAuthOutpoint.vout(),
      factoryAuthTx,
      TxOutSecrets.fromExplicit(AssetId.fromString(factoryAssetString), NFT_AMOUNT),
      EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
      true,
    )
    const borrowerNftAsset = assetIdFromIssuance(
      issuanceFactoryOutpoint,
      ContractHash.fromBytes(new Uint8Array(32)),
    )
    const lenderNftAsset = assetIdFromIssuance(
      lenderNftIssuanceOutpoint,
      ContractHash.fromBytes(new Uint8Array(32)),
    )
    const borrowerNftAssetString = borrowerNftAsset.toString()
    const lenderNftAssetString = lenderNftAsset.toString()
    const loanDurationBlocks = params.loanDurationBlocks
    if (params.principalInterestRate > MAX_PRINCIPAL_INTEREST_RATE_BPS) {
      throw new Error(
        `Interest rate is too high. Max is ${MAX_PRINCIPAL_INTEREST_RATE_BPS.toString()} bps ` +
          `(${(MAX_PRINCIPAL_INTEREST_RATE_BPS / 100).toFixed(2)}%).`,
      )
    }
    const offerParameters = {
      collateralAmount: toUint64(params.collateralAmount, 'collateralAmount'),
      principalAmount: toUint64(params.principalAmount, 'principalAmount'),
      principalInterestRate: toUint16(params.principalInterestRate, 'principalInterestRate'),
      loanExpirationTime: toUint32(currentBlockHeight + loanDurationBlocks, 'loanExpirationTime'),
    }
    const collateralAssetId = toBytes32(
      AssetId.fromString(policyAssetString).toBytes(),
      'collateralAssetId',
    )
    const principalAssetId = toBytes32(
      AssetId.fromString(principalAssetString).toBytes(),
      'principalAssetId',
    )
    const borrowerNftAssetId = toBytes32(borrowerNftAsset.toBytes(), 'borrowerNftAssetId')
    const lenderNftAssetId = toBytes32(lenderNftAsset.toBytes(), 'lenderNftAssetId')
    const protocolFeeKeeperAssetId = toBytes32(
      AssetId.fromString(protocolFeeKeeperAssetString).toBytes(),
      'protocolFeeKeeperAssetId',
    )

    const derivedLendingParams = buildDerivedLendingOfferProgramParams({
      collateralAssetId,
      principalAssetId,
      borrowerNftAssetId,
      lenderNftAssetId,
      protocolFeeKeeperAssetId,
      offerParameters,
    })
    const lendingProgram = loadLendingProgram(derivedLendingParams)
    const lendingSpendInfo = buildLendingOfferSpendInfo(lendingProgram, {
      principalAmount: offerParameters.principalAmount,
      principalInterestRate: offerParameters.principalInterestRate,
    })
    const lendingScript = lendingSpendInfo.scriptPubkey
    const lendingScriptPubkeyHex = bytesToHex(lendingScript.bytes())
    const lendingScriptHash = toBytes32(
      hexToBytes(lendingScript.jet_sha256_hex()),
      'lendingScriptHash',
    )
    const lenderNftScriptAuthProgram = loadScriptAuthProgram(lendingScriptHash)
    const lenderNftScriptAuthAddress = lenderNftScriptAuthProgram.createP2trAddress(
      XOnlyPublicKey.fromString(UNSPENDABLE_TAPROOT_PUBKEY),
      lwkNetwork,
    )
    const lenderNftScriptAuthAddressString = lenderNftScriptAuthAddress.toString()
    let txBuilder = new TxBuilder(lwkNetwork)
    txBuilder = txBuilder.feeRate(feeRate)
    txBuilder = txBuilder
      .setWalletUtxos(params.collateralOutpoints.map(outpoint => new OutPoint(outpoint)))
      .setInputOrder([
        new OutPoint(params.factoryAuthOutpoint),
        new OutPoint(params.issuanceFactoryOutpoint),
        ...params.collateralOutpoints.map(outpoint => new OutPoint(outpoint)),
      ])

    const externalUtxos = [factoryAuthExternalUtxo, issuanceFactoryExternalUtxo]
    txBuilder = txBuilder.addExternalUtxos(externalUtxos)
    txBuilder = txBuilder.addExplicitRecipient(
      new Address(receiveAddressExplicitString),
      NFT_AMOUNT,
      AssetId.fromString(factoryAssetString),
    )
    txBuilder = txBuilder.addExplicitRecipient(
      new Address(issuanceFactoryAddressString),
      NFT_AMOUNT,
      AssetId.fromString(factoryAssetString),
    )
    txBuilder = txBuilder.issueAssetToRecipients(
      [IssuanceRecipient.fromAddress(NFT_AMOUNT, new Address(receiveAddressExplicitString))],
      REISSUANCE_TOKEN_AMOUNT,
      null,
      null,
      new OutPoint(params.issuanceFactoryOutpoint),
    )
    txBuilder = txBuilder.issueAssetToRecipients(
      [IssuanceRecipient.fromAddress(NFT_AMOUNT, new Address(lenderNftScriptAuthAddressString))],
      REISSUANCE_TOKEN_AMOUNT,
      null,
      null,
      new OutPoint(lenderNftIssuanceOutpointString),
    )
    const pendingOfferMetadataPayload = await encodePendingOfferMetadata({
      principalAssetId,
      principalAmount: offerParameters.principalAmount,
      loanExpirationTime: offerParameters.loanExpirationTime,
      principalInterestRate: offerParameters.principalInterestRate,
    })
    const pendingOfferMetadataScript = Script.newOpReturn(pendingOfferMetadataPayload)

    txBuilder = txBuilder.addPostIssuanceScriptOutput(
      pendingOfferMetadataScript,
      0n,
      AssetId.fromString(policyAssetString),
    )
    txBuilder = txBuilder.addPostIssuanceScriptOutput(
      lendingScript,
      offerParameters.collateralAmount,
      AssetId.fromString(policyAssetString),
    )
    const pset = txBuilder.finish(wollet)
    const signedPset = await signPset(pset)
    const finalizedWalletPset = wollet.finalize(signedPset)
    const txWithWalletWitnesses = finalizedWalletPset.extractTx()
    const finalizedTx = issuanceFactoryProgram.finalizeTransactionWithSpendInfo(
      txWithWalletWitnesses,
      buildCovenantSpendInfo(issuanceFactoryProgram),
      [factoryAuthTxOut, issuanceFactoryTxOut, ...collateralTxOuts],
      1,
      buildIssuanceFactoryWitness({
        branch: 'IssueAssets',
        outputIndex: toUint32(0, 'outputIndex'),
      }),
      lwkNetwork,
      SimplicityLogLevel.Trace,
    )
    const txid = await broadcastTx(finalizedTx.toString())

    return {
      txid,
      // TODO: Remove debug summary before release
      summary: {
        inputs: {
          '0 FactoryAuth': params.factoryAuthOutpoint,
          '1 IssuanceFactory covenant': params.issuanceFactoryOutpoint,
          '2+ Collateral LBTC': params.collateralOutpoints.join(', '),
          lenderNftIssuanceOutpoint: lenderNftIssuanceOutpointString,
        },
        outputs: {
          '0 FactoryAuth back to user': receiveAddressExplicitString,
          '1 IssuanceFactory back to covenant': issuanceFactoryAddressString,
          '2 Borrower NFT to user': receiveAddressExplicitString,
          '3 Lender NFT to ScriptAuth': lenderNftScriptAuthAddressString,
          '4 Metadata OP_RETURN': bytesToHex(pendingOfferMetadataScript.bytes()),
          '5 Lending covenant': lendingScriptPubkeyHex,
        },
        assetIds: {
          factoryAssetId: factoryAssetString,
          collateralAssetId: policyAssetString,
          principalAssetId: principalAssetString,
          borrowerNftAssetId: borrowerNftAssetString,
          lenderNftAssetId: lenderNftAssetString,
          protocolFeeKeeperAssetId: protocolFeeKeeperAssetString,
        },
        scripts: {
          lendingScriptHash: bytesToHex(lendingScriptHash),
          lenderVaultCovHash: bytesToHex(derivedLendingParams.lenderVaultCovHash),
          finalizedLenderVaultCovHash: bytesToHex(derivedLendingParams.finalizedLenderVaultCovHash),
          protocolFeeVaultCovHash: bytesToHex(derivedLendingParams.protocolFeeVaultCovHash),
          finalizedProtocolFeeVaultCovHash: bytesToHex(
            derivedLendingParams.finalizedProtocolFeeVaultCovHash,
          ),
          principalOutputScriptHash: bytesToHex(derivedLendingParams.principalOutputScriptHash),
        },
        offerParameters: {
          collateralAmount: offerParameters.collateralAmount.toString(),
          principalAmount: offerParameters.principalAmount.toString(),
          principalInterestRate: offerParameters.principalInterestRate.toString(),
          currentBlockHeight: currentBlockHeight.toString(),
          loanDurationBlocks: loanDurationBlocks.toString(),
          loanExpirationTime: offerParameters.loanExpirationTime.toString(),
        },
        metadataOpReturnHex: bytesToHex(pendingOfferMetadataScript.bytes()),
      },
    }
  }

  return { createOffer }
}
