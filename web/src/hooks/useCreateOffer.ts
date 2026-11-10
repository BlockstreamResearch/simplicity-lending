import {
  Address,
  AssetId,
  assetIdFromIssuance,
  OutPoint,
  type Pset,
  Script,
  SimplicityLogLevel,
  type TxOutSecrets,
  XOnlyPublicKey,
} from 'lwk_wasm'

import { fetchFeeRateSatPerKvbAbovePending } from '@/api/esplora/fee'
import { fetchLatestBlockHeight } from '@/api/esplora/methods'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { AssetKind, buildAssetContract, contractHashOrEmpty } from '@/lwk/assetContract'
import { buildPset, type PsetBlinding } from '@/lwk/psetBuilder'
import {
  assertExplicitAmount,
  fetchTransaction,
  requireExplicitAsset,
  requireTxOut,
  type UpdatedPset,
} from '@/lwk/transaction'
import {
  assertWalletUtxoAssetAndMinimumAmount,
  EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
  requireWalletUtxo,
  WALLET_INPUT_RBF_SEQUENCE,
} from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
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
import { getProcessingTxids } from '@/utils/pendingTransactions'
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

export interface CreateOfferSummary {
  inputs: Record<string, string>
  outputs: Record<string, string>
  assetIds: Record<string, string>
  scripts: Record<string, string>
  offerParameters: Record<string, string>
  metadataOpReturnHex: string
}

export function useCreateOffer() {
  const { lwkNetwork } = useLwk()
  const {
    getReceiveAddress,
    getChangeAddress,
    getBlindedWalletUtxos,
    getWollet,
    syncWallet,
    signerType,
  } = useWallet()
  const { pendingTxs } = usePendingTransactions()

  const createOffer = async (
    params: CreateOfferParams,
  ): Promise<UpdatedPset<CreateOfferSummary>> => {
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
        fetchFeeRateSatPerKvbAbovePending(getProcessingTxids(pendingTxs)),
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
    const receiveExplicitAddress = Address.parse(
      receiveAddressString,
      lwkNetwork,
    ).toUnconfidential()
    const issuanceFactoryProgram = loadIssuanceFactoryProgram({
      issuingUtxosCount: toUint8(ISSUING_UTXOS_COUNT, 'issuingUtxosCount'),
      reissuanceFlags: toUint64(REISSUANCE_FLAGS, 'reissuanceFlags'),
    })
    const issuanceFactoryAddress = issuanceFactoryProgram.createP2trAddress(
      XOnlyPublicKey.fromString(UNSPENDABLE_TAPROOT_PUBKEY),
      lwkNetwork,
    )

    const borrowerNftContract = buildAssetContract(issuanceFactoryOutpoint, AssetKind.BorrowerNft)
    const lenderNftContract = buildAssetContract(lenderNftIssuanceOutpoint, AssetKind.LenderNft)
    const borrowerNftContractHash = await contractHashOrEmpty(borrowerNftContract)
    const lenderNftContractHash = await contractHashOrEmpty(lenderNftContract)
    const borrowerNftAsset = assetIdFromIssuance(issuanceFactoryOutpoint, borrowerNftContractHash)
    const lenderNftAsset = assetIdFromIssuance(lenderNftIssuanceOutpoint, lenderNftContractHash)
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
    const pendingOfferMetadataPayload = await encodePendingOfferMetadata({
      principalAssetId,
      principalAmount: offerParameters.principalAmount,
      loanExpirationTime: offerParameters.loanExpirationTime,
      principalInterestRate: offerParameters.principalInterestRate,
    })
    const pendingOfferMetadataScript = Script.newOpReturn(pendingOfferMetadataPayload)

    const factoryAsset = AssetId.fromString(factoryAssetString)
    const policyAsset = lwkNetwork.policyAsset()
    const receiveExplicitScript = receiveExplicitAddress.scriptPubkey()
    const blinding: PsetBlinding = signerType === 'humid' ? 'wallet' : 'local'

    const changeAddress = await getChangeAddress()
    const { pset } = buildPset({
      network: lwkNetwork,
      inputs: [
        {
          outpoint: factoryAuthOutpoint,
          prevout: factoryAuthTxOut,
          asset: factoryAsset,
          amount: NFT_AMOUNT,
          maxWeightToSatisfy: EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
        },
        {
          outpoint: issuanceFactoryOutpoint,
          prevout: issuanceFactoryTxOut,
          asset: factoryAsset,
          amount: NFT_AMOUNT,
          maxWeightToSatisfy: ISSUANCE_FACTORY_MAX_WEIGHT_TO_SATISFY.IssueAssets,
          issuance: {
            assetAmount: NFT_AMOUNT,
            tokenAmount: REISSUANCE_TOKEN_AMOUNT,
            contractHash: borrowerNftContractHash,
          },
        },
        ...collateralUtxos.map((utxo, index) => ({
          outpoint: collateralOutpoints[index],
          prevout: collateralTxOuts[index],
          asset: utxo.unblinded().asset(),
          amount: utxo.unblinded().value(),
          secrets: blinding === 'local' ? (utxo.unblinded() as TxOutSecrets) : undefined,
          walletCoin: true,
          sequence: index === 0 ? WALLET_INPUT_RBF_SEQUENCE : undefined,
          maxWeightToSatisfy: wollet.maxWeightToSatisfy(),
          issuance:
            index === 0
              ? {
                  assetAmount: NFT_AMOUNT,
                  tokenAmount: REISSUANCE_TOKEN_AMOUNT,
                  contractHash: lenderNftContractHash,
                }
              : undefined,
        })),
      ],
      outputs: [
        { script: receiveExplicitScript, amount: NFT_AMOUNT, asset: factoryAsset },
        { script: issuanceFactoryAddress.scriptPubkey(), amount: NFT_AMOUNT, asset: factoryAsset },
        { script: receiveExplicitScript, amount: NFT_AMOUNT, asset: borrowerNftAsset },
        {
          script: lenderNftScriptAuthAddress.scriptPubkey(),
          amount: NFT_AMOUNT,
          asset: lenderNftAsset,
        },
        { script: pendingOfferMetadataScript, amount: 0n, asset: policyAsset },
        { script: lendingScript, amount: offerParameters.collateralAmount, asset: policyAsset },
      ],
      changeAddress,
      feeRateSatPerKvb: feeRate,
      blinding,
    })
    pset.addDetails(wollet)

    return {
      pset,
      finalize: (signedPset: Pset) => {
        const finalizedWalletPset = wollet.finalize(signedPset)
        const txWithWalletWitnesses = finalizedWalletPset.extractTx()
        const finalizedTx = issuanceFactoryProgram.finalizeTransaction(
          txWithWalletWitnesses,
          buildCovenantSpendInfo(issuanceFactoryProgram).controlBlock(issuanceFactoryProgram.cmr),
          [factoryAuthTxOut, issuanceFactoryTxOut, ...collateralTxOuts],
          1,
          buildIssuanceFactoryWitness({
            branch: 'IssueAssets',
            outputIndex: toUint32(0, 'outputIndex'),
          }),
          lwkNetwork,
          SimplicityLogLevel.Trace,
        )

        return {
          finalizedTx,
          // TODO: Remove debug summary before release
          summary: {
            inputs: {
              '0 FactoryAuth': params.factoryAuthOutpoint,
              '1 IssuanceFactory covenant': params.issuanceFactoryOutpoint,
              [`2+ Collateral ${NETWORK_CONFIG.collateralAsset.symbol}`]:
                params.collateralOutpoints.join(', '),
              lenderNftIssuanceOutpoint: lenderNftIssuanceOutpointString,
            },
            outputs: {
              '0 FactoryAuth back to user': receiveExplicitAddress.toString(),
              '1 IssuanceFactory back to covenant': issuanceFactoryAddress.toString(),
              '2 Borrower NFT to user': receiveExplicitAddress.toString(),
              '3 Lender NFT to ScriptAuth': lenderNftScriptAuthAddress.toString(),
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
              lenderVaultTapleafHash: bytesToHex(derivedLendingParams.lenderVaultTapleafHash),
              protocolFeeVaultTapleafHash: bytesToHex(
                derivedLendingParams.protocolFeeVaultTapleafHash,
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
      },
    }
  }

  return { createOffer }
}
