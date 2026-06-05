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
} from 'lwk_web'

import { broadcastTx, fetchLatestBlockHeight, fetchTxRaw } from '@/api/esplora/methods'
import { utxoToOutpointString } from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import {
  buildIssuanceFactoryWitness,
  loadIssuanceFactoryProgram,
} from '@/simplicity/issuance-factory/program'
import {
  buildDerivedLendingOfferProgramParams,
  buildPendingOfferMetadata,
  loadLendingProgram,
} from '@/simplicity/lending/program'
import { loadScriptAuthProgram } from '@/simplicity/script-auth/program'
import { bytesToHex, hexToBytes } from '@/utils/hex'

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

export interface CreateOfferSummary {
  inputs: Record<string, string>
  outputs: Record<string, string>
  assetIds: Record<string, string>
  scripts: Record<string, string>
  offerParameters: Record<string, string>
  metadataOpReturnHex: string
}

export interface CreateOfferResult {
  txid: string
  summary: CreateOfferSummary
}

export function useCreateOffer() {
  const { lwkNetwork } = useLwk()
  const { getReceiveAddress, getWalletUtxos, getWollet, getXOnlyPublicKey, signPset, syncWallet } =
    useWallet()

  const createOffer = async (params: CreateOfferParams): Promise<CreateOfferResult> => {
    let stage = 'initializing'
    try {
      stage = 'get x-only public key'
      const xOnlyPublicKey = await getXOnlyPublicKey()
      if (!xOnlyPublicKey) throw new Error('Missing x-only public key')

      stage = 'get receive address'
      const receiveAddressString = await getReceiveAddress()
      if (!receiveAddressString) throw new Error('Missing receive address')

      stage = 'get wollet'
      const wollet = await getWollet()
      if (!wollet) throw new Error('Wallet not connected')

      stage = 'sync wallet and load UTXOs'
      await syncWallet()
      const walletUtxos = await getWalletUtxos()
      const factoryAuthUtxo = walletUtxos.find(
        utxo => utxoToOutpointString(utxo) === params.factoryAuthOutpoint,
      )
      const collateralUtxo = requireWalletUtxo(walletUtxos, params.collateralOutpoint, 'Collateral')

      stage = 'prepare validated params'
      const factoryAsset = AssetId.fromString(params.factoryAssetId)
      const principalAsset = AssetId.fromString(params.principalAssetId)
      const protocolFeeKeeperAsset = AssetId.fromString(params.protocolFeeKeeperAssetId)
      const policyAsset = lwkNetwork.policyAsset()
      const factoryAssetString = factoryAsset.toString()
      const principalAssetString = principalAsset.toString()
      const protocolFeeKeeperAssetString = protocolFeeKeeperAsset.toString()
      const policyAssetString = policyAsset.toString()

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

      const issuanceFactoryOutpoint = new OutPoint(params.issuanceFactoryOutpoint)
      const collateralOutpoint = new OutPoint(params.collateralOutpoint)

      stage = 'prepare addresses and IssuanceFactory external UTXO'
      const receiveAddressExplicitString = Address.parse(receiveAddressString, lwkNetwork)
        .toUnconfidential()
        .toString()
      const issuanceFactoryProgram = loadIssuanceFactoryProgram({
        issuingUtxosCount: ISSUING_UTXOS_COUNT,
        reissuanceFlags: REISSUANCE_FLAGS,
      })
      const issuanceFactoryAddress = issuanceFactoryProgram.createP2trAddress(
        xOnlyPublicKey,
        lwkNetwork,
      )
      const issuanceFactoryAddressString = issuanceFactoryAddress.toString()

      const issuanceFactoryTx = Transaction.fromBytes(
        await fetchTxRaw(issuanceFactoryOutpoint.txid().toString()),
      )
      const issuanceFactoryTxOut = issuanceFactoryTx.outputs[issuanceFactoryOutpoint.vout()]
      if (!issuanceFactoryTxOut)
        throw new Error('IssuanceFactory transaction does not have the selected output')

      const issuanceFactoryExternalUtxo = new ExternalUtxo(
        issuanceFactoryOutpoint.vout(),
        issuanceFactoryTx,
        TxOutSecrets.fromExplicit(AssetId.fromString(factoryAssetString), NFT_AMOUNT),
        DEFAULT_EXTERNAL_UTXO_MAX_WEIGHT_TO_SATISFY,
        true,
      )
      const factoryAuthExternalUtxo = factoryAuthUtxo
        ? null
        : await buildExplicitExternalUtxo(
            params.factoryAuthOutpoint,
            factoryAssetString,
            NFT_AMOUNT,
            'FactoryAuth',
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
      const currentBlockHeight = await fetchLatestBlockHeight()
      const loanDurationBlocks = params.loanDurationBlocks
      const offerParameters = {
        collateralAmount: params.collateralAmount,
        principalAmount: params.principalAmount,
        principalInterestRate: params.principalInterestRate,
        loanExpirationTime: currentBlockHeight + loanDurationBlocks,
      }

      stage = 'compile lending and ScriptAuth programs'
      const derivedLendingParams = buildDerivedLendingOfferProgramParams(
        {
          collateralAssetId: AssetId.fromString(policyAssetString).toBytes(),
          principalAssetId: AssetId.fromString(principalAssetString).toBytes(),
          borrowerNftAssetId: AssetId.fromString(borrowerNftAssetString).toBytes(),
          lenderNftAssetId: AssetId.fromString(lenderNftAssetString).toBytes(),
          protocolFeeKeeperAssetId: AssetId.fromString(protocolFeeKeeperAssetString).toBytes(),
          offerParameters,
        },
        xOnlyPublicKey,
        lwkNetwork,
      )
      const lendingProgram = loadLendingProgram(derivedLendingParams)
      const lendingAddress = lendingProgram.createP2trAddress(xOnlyPublicKey, lwkNetwork)
      const lendingAddressString = lendingAddress.toString()
      const lendingScriptPubkeyHex = bytesToHex(lendingAddress.scriptPubkey().bytes())
      const lendingScriptHash = hexToBytes(new Script(lendingScriptPubkeyHex).jet_sha256_hex())
      const lenderNftScriptAuthProgram = loadScriptAuthProgram(lendingScriptHash)
      const lenderNftScriptAuthAddress = lenderNftScriptAuthProgram.createP2trAddress(
        xOnlyPublicKey,
        lwkNetwork,
      )
      const lenderNftScriptAuthAddressString = lenderNftScriptAuthAddress.toString()
      const metadata = await buildPendingOfferMetadata({
        principalAssetId: AssetId.fromString(principalAssetString).toBytes(),
        offerParameters,
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
        new Script(lendingScriptPubkeyHex),
        offerParameters.collateralAmount,
        AssetId.fromString(policyAssetString),
      )

      stage = 'TxBuilder.finish'
      const pset = txBuilder.finish(wollet)

      stage = 'sign offer PSET'
      const signedPset = await signPset(pset)

      stage = 'finalize wallet inputs'
      const finalizedWalletPset = wollet.finalize(signedPset)

      stage = 'load previous txouts for Simplicity finalize'
      const finalizationFactoryAuthOutpoint = new OutPoint(params.factoryAuthOutpoint)
      const finalizationCollateralOutpoint = new OutPoint(params.collateralOutpoint)
      const factoryAuthTx = Transaction.fromBytes(
        await fetchTxRaw(finalizationFactoryAuthOutpoint.txid().toString()),
      )
      const factoryAuthTxOut = factoryAuthTx.outputs[finalizationFactoryAuthOutpoint.vout()]
      if (!factoryAuthTxOut)
        throw new Error('FactoryAuth transaction does not have the selected output')

      const collateralTx = Transaction.fromBytes(
        await fetchTxRaw(finalizationCollateralOutpoint.txid().toString()),
      )
      const collateralTxOut = collateralTx.outputs[finalizationCollateralOutpoint.vout()]
      if (!collateralTxOut)
        throw new Error('Collateral transaction does not have the selected output')

      stage = 'finalize IssuanceFactory covenant input'
      const txWithWalletWitnesses = finalizedWalletPset.extractTx()
      const finalizedTx = issuanceFactoryProgram.finalizeTransaction(
        txWithWalletWitnesses,
        xOnlyPublicKey,
        [factoryAuthTxOut, issuanceFactoryTxOut, collateralTxOut],
        1,
        buildIssuanceFactoryWitness({ branch: 'IssueAssets', outputIndex: 0 }),
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

async function buildExplicitExternalUtxo(
  outpointString: string,
  assetIdString: string,
  amount: bigint,
  label: string,
): Promise<ExternalUtxo> {
  const outpoint = new OutPoint(outpointString)
  const tx = Transaction.fromBytes(await fetchTxRaw(outpoint.txid().toString()))
  const txOut = tx.outputs[outpoint.vout()]
  if (!txOut) throw new Error(`${label} transaction does not have the selected output`)

  return new ExternalUtxo(
    outpoint.vout(),
    tx,
    TxOutSecrets.fromExplicit(AssetId.fromString(assetIdString), amount),
    DEFAULT_EXTERNAL_UTXO_MAX_WEIGHT_TO_SATISFY,
    true,
  )
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
