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
  Transaction,
  TxBuilder,
  TxOutSecrets,
  type WalletTxOut,
  XOnlyPublicKey,
} from 'lwk_web'

import { broadcastTx, fetchLatestBlockHeight, fetchTxRaw } from '@/api/esplora/methods'
import { utxoToOutpointString } from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import {
  buildIssuanceFactoryWitness,
  loadIssuanceFactoryProgram,
} from '@/simplicity/issuance-factory/program'
import { buildPendingOfferMetadata } from '@/simplicity/lending/metadata'
import {
  buildDerivedLendingOfferProgramParams,
  buildLendingOfferSpendInfo,
  loadLendingProgram,
} from '@/simplicity/lending/program'
import { loadScriptAuthProgram } from '@/simplicity/script-auth/program'
import { buildCovenantSpendInfo, NUMS_KEY } from '@/simplicity/taproot'
import { bytesToHex, hexToBytes } from '@/utils/hex'
import { toBytes32, toUint8, toUint16, toUint32, toUint64 } from '@/utils/uint'

const ISSUING_UTXOS_COUNT = 2
const REISSUANCE_FLAGS = 0n
const REISSUANCE_TOKEN_AMOUNT = 0n
const NFT_AMOUNT = 1n
const DEFAULT_FEE_RATE = 100
const DEFAULT_EXTERNAL_UTXO_MAX_WEIGHT_TO_SATISFY = 30_000

export interface CreateOfferParams {
  factoryAuthOutpoint: string
  issuanceFactoryOutpoint: string
  factoryAssetId: string
  collateralOutpoint: string
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
  const { getReceiveAddress, getWalletUtxos, getWollet, signPset, syncWallet } = useWallet()

  const createOffer = async (params: CreateOfferParams): Promise<CreateOfferResult> => {
    let stage = 'initializing'
    try {
      stage = 'load wallet context'
      const [receiveAddressString, wollet] = await Promise.all([getReceiveAddress(), getWollet()])
      if (!receiveAddressString) throw new Error('Missing receive address')

      stage = 'sync wallet and load UTXOs'
      await syncWallet()
      const walletUtxos = await getWalletUtxos()
      const factoryAuthUtxo = walletUtxos.find(
        utxo => utxoToOutpointString(utxo) === params.factoryAuthOutpoint,
      )
      const collateralUtxo = requireWalletUtxo(walletUtxos, params.collateralOutpoint, 'Collateral')

      stage = 'prepare validated params'
      const factoryAssetString = params.factoryAssetId
      const principalAssetString = params.principalAssetId
      const protocolFeeKeeperAssetString = params.protocolFeeKeeperAssetId
      const policyAssetString = lwkNetwork.policyAsset().toString()

      if (factoryAuthUtxo) {
        assertWalletUtxoAssetAndAmount(
          factoryAuthUtxo,
          factoryAssetString,
          NFT_AMOUNT,
          'FactoryAuth',
        )
      }
      assertWalletUtxoAssetAndAmount(
        collateralUtxo,
        policyAssetString,
        params.collateralAmount,
        'Collateral',
      )

      const factoryAuthOutpoint = new OutPoint(params.factoryAuthOutpoint)
      const issuanceFactoryOutpoint = new OutPoint(params.issuanceFactoryOutpoint)
      const collateralOutpoint = new OutPoint(params.collateralOutpoint)

      stage = 'load transaction context'
      const [factoryAuthTxBytes, issuanceFactoryTxBytes, collateralTxBytes, currentBlockHeight] =
        await Promise.all([
          fetchTxRaw(factoryAuthOutpoint.txid().toString()),
          fetchTxRaw(issuanceFactoryOutpoint.txid().toString()),
          fetchTxRaw(collateralOutpoint.txid().toString()),
          fetchLatestBlockHeight(),
        ])
      const factoryAuthTx = Transaction.fromBytes(factoryAuthTxBytes)
      const issuanceFactoryTx = Transaction.fromBytes(issuanceFactoryTxBytes)
      const collateralTx = Transaction.fromBytes(collateralTxBytes)
      const factoryAuthTxOut = factoryAuthTx.outputs[factoryAuthOutpoint.vout()]
      const issuanceFactoryTxOut = issuanceFactoryTx.outputs[issuanceFactoryOutpoint.vout()]
      const collateralTxOut = collateralTx.outputs[collateralOutpoint.vout()]
      if (!factoryAuthTxOut)
        throw new Error('FactoryAuth transaction does not have the selected output')
      if (!issuanceFactoryTxOut)
        throw new Error('IssuanceFactory transaction does not have the selected output')
      if (!collateralTxOut)
        throw new Error('Collateral transaction does not have the selected output')

      stage = 'prepare addresses and external UTXOs'
      const receiveAddressExplicitString = Address.parse(receiveAddressString, lwkNetwork)
        .toUnconfidential()
        .toString()
      const issuanceFactoryProgram = loadIssuanceFactoryProgram({
        issuingUtxosCount: toUint8(ISSUING_UTXOS_COUNT, 'issuingUtxosCount'),
        reissuanceFlags: toUint64(REISSUANCE_FLAGS, 'reissuanceFlags'),
      })
      const issuanceFactoryAddress = issuanceFactoryProgram.createP2trAddress(
        XOnlyPublicKey.fromString(NUMS_KEY),
        lwkNetwork,
      )
      const issuanceFactoryAddressString = issuanceFactoryAddress.toString()

      const issuanceFactoryExternalUtxo = new ExternalUtxo(
        issuanceFactoryOutpoint.vout(),
        issuanceFactoryTx,
        TxOutSecrets.fromExplicit(AssetId.fromString(factoryAssetString), NFT_AMOUNT),
        DEFAULT_EXTERNAL_UTXO_MAX_WEIGHT_TO_SATISFY,
        true,
      )
      const factoryAuthExternalUtxo = factoryAuthUtxo
        ? null
        : new ExternalUtxo(
            factoryAuthOutpoint.vout(),
            factoryAuthTx,
            TxOutSecrets.fromExplicit(AssetId.fromString(factoryAssetString), NFT_AMOUNT),
            DEFAULT_EXTERNAL_UTXO_MAX_WEIGHT_TO_SATISFY,
            true,
          )

      const borrowerNftAsset = assetIdFromIssuance(
        issuanceFactoryOutpoint,
        ContractHash.fromBytes(new Uint8Array(32)),
      )
      const lenderNftAsset = assetIdFromIssuance(
        collateralOutpoint,
        ContractHash.fromBytes(new Uint8Array(32)),
      )
      const borrowerNftAssetString = borrowerNftAsset.toString()
      const lenderNftAssetString = lenderNftAsset.toString()
      const loanDurationBlocks = params.loanDurationBlocks
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

      stage = 'compile lending and ScriptAuth programs'
      // TODO: Indexer will handle this
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
      const lendingAddressString = bytesToHex(lendingScript.bytes())
      const lendingScriptHash = toBytes32(
        hexToBytes(lendingScript.jet_sha256_hex()),
        'lendingScriptHash',
      )
      const lenderNftScriptAuthProgram = loadScriptAuthProgram(lendingScriptHash)
      const lenderNftScriptAuthAddress = lenderNftScriptAuthProgram.createP2trAddress(
        XOnlyPublicKey.fromString(NUMS_KEY),
        lwkNetwork,
      )
      const lenderNftScriptAuthAddressString = lenderNftScriptAuthAddress.toString()
      const metadata = await buildPendingOfferMetadata({
        principalAssetId,
        principalAmount: offerParameters.principalAmount,
        loanExpirationTime: offerParameters.loanExpirationTime,
        principalInterestRate: offerParameters.principalInterestRate,
      })

      stage = 'TxBuilder.new'
      let txBuilder = new TxBuilder(lwkNetwork)

      stage = 'TxBuilder.feeRate'
      txBuilder = txBuilder.feeRate(DEFAULT_FEE_RATE)

      stage = 'TxBuilder.setInputOrder'
      txBuilder = txBuilder.setInputOrder([
        new OutPoint(params.factoryAuthOutpoint),
        new OutPoint(params.issuanceFactoryOutpoint),
        new OutPoint(params.collateralOutpoint),
      ])

      const externalUtxos = factoryAuthExternalUtxo
        ? [factoryAuthExternalUtxo, issuanceFactoryExternalUtxo]
        : [issuanceFactoryExternalUtxo]

      stage = 'TxBuilder.addExternalUtxos covenant/explicit inputs'
      txBuilder = txBuilder.addExternalUtxos(externalUtxos)

      stage = 'TxBuilder.addExplicitRecipient FactoryAuth back to user'
      txBuilder = txBuilder.addExplicitRecipient(
        new Address(receiveAddressExplicitString),
        NFT_AMOUNT,
        AssetId.fromString(factoryAssetString),
      )

      stage = 'TxBuilder.addExplicitRecipient IssuanceFactory covenant'
      txBuilder = txBuilder.addExplicitRecipient(
        new Address(issuanceFactoryAddressString),
        NFT_AMOUNT,
        AssetId.fromString(factoryAssetString),
      )

      stage = 'TxBuilder.issueAssetToRecipients Borrower NFT to user'
      txBuilder = txBuilder.issueAssetToRecipients(
        [IssuanceRecipient.fromAddress(NFT_AMOUNT, new Address(receiveAddressExplicitString))],
        REISSUANCE_TOKEN_AMOUNT,
        null,
        null,
        new OutPoint(params.issuanceFactoryOutpoint),
      )

      stage = 'TxBuilder.issueAssetToRecipients Lender NFT to ScriptAuth'
      txBuilder = txBuilder.issueAssetToRecipients(
        [IssuanceRecipient.fromAddress(NFT_AMOUNT, new Address(lenderNftScriptAuthAddressString))],
        REISSUANCE_TOKEN_AMOUNT,
        null,
        null,
        new OutPoint(params.collateralOutpoint),
      )

      stage = 'TxBuilder.addExplicitScriptOutput metadata OP_RETURN'
      txBuilder = txBuilder.addExplicitScriptOutput(
        Script.newOpReturn(metadata),
        0n,
        AssetId.fromString(policyAssetString),
      )

      stage = 'TxBuilder.addExplicitScriptOutput Lending covenant collateral'
      txBuilder = txBuilder.addExplicitScriptOutput(
        lendingScript,
        offerParameters.collateralAmount,
        AssetId.fromString(policyAssetString),
      )

      stage = 'TxBuilder.finish'
      const pset = txBuilder.finish(wollet)

      stage = 'sign offer PSET'
      const signedPset = await signPset(pset)

      stage = 'finalize wallet inputs'
      const finalizedWalletPset = wollet.finalize(signedPset)

      stage = 'finalize IssuanceFactory covenant input'
      const txWithWalletWitnesses = finalizedWalletPset.extractTx()
      const finalizedTx = issuanceFactoryProgram.finalizeTransactionWithSpendInfo(
        txWithWalletWitnesses,
        buildCovenantSpendInfo(issuanceFactoryProgram),
        [factoryAuthTxOut, issuanceFactoryTxOut, collateralTxOut],
        1,
        buildIssuanceFactoryWitness({
          branch: 'IssueAssets',
          outputIndex: toUint32(0, 'outputIndex'),
        }),
        lwkNetwork,
        SimplicityLogLevel.Trace,
      )

      stage = 'broadcast transaction'
      const txid = await broadcastTx(finalizedTx.toString())

      return {
        txid,
        summary: {
          inputs: {
            '0 FactoryAuth': params.factoryAuthOutpoint,
            '1 IssuanceFactory covenant': params.issuanceFactoryOutpoint,
            '2 Collateral LBTC': params.collateralOutpoint,
          },
          outputs: {
            '0 FactoryAuth back to user': receiveAddressExplicitString,
            '1 IssuanceFactory back to covenant': issuanceFactoryAddressString,
            '2 Borrower NFT to user': receiveAddressExplicitString,
            '3 Lender NFT to ScriptAuth': lenderNftScriptAuthAddressString,
            '4 Metadata OP_RETURN': bytesToHex(Script.newOpReturn(metadata).bytes()),
            '5 Lending covenant': lendingAddressString,
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
            finalizedLenderVaultCovHash: bytesToHex(
              derivedLendingParams.finalizedLenderVaultCovHash,
            ),
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
          metadataOpReturnHex: bytesToHex(Script.newOpReturn(metadata).bytes()),
        },
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      const errorBody =
        err instanceof Error && 'body' in err && typeof err.body === 'string' ? err.body : null
      throw new Error(`${stage}: ${errorMessage}${errorBody ? ` | response: ${errorBody}` : ''}`)
    }
  }

  return { createOffer }
}

function requireWalletUtxo(
  walletUtxos: WalletTxOut[],
  outpoint: string,
  label: string,
): WalletTxOut {
  const utxo = walletUtxos.find(u => utxoToOutpointString(u) === outpoint.trim())
  if (!utxo) throw new Error(`${label} wallet UTXO not found`)
  return utxo
}

function assertWalletUtxoAssetAndAmount(
  utxo: WalletTxOut,
  assetId: string,
  minAmount: bigint,
  label: string,
) {
  const unblinded = utxo.unblinded()
  if (unblinded.asset().toString() !== assetId)
    throw new Error(`${label} UTXO has unexpected asset ${unblinded.asset().toString()}`)
  if (unblinded.value() < minAmount)
    throw new Error(`${label} UTXO amount is lower than ${minAmount.toString()}`)
}
