/**
 * Bringing a factory into existence, which is what this dapp calls a borrower account.
 *
 * The eighth action of the deployed document, and the first: every other one presupposes a factory
 * to mint an offer from. It issues two units of a new asset in one transaction — one back to the
 * account as its auth NFT, one to the factory covenant — and records what it did in an OP_RETURN.
 *
 * Moved out of `hooks/useBorrowerAccount.ts`, which built it while the page still built its own
 * transactions. That file stays where it is, unreachable, as the rest of the superseded layer
 * does; this is the same builder over the wallet access every other action takes.
 */

import {
  Address,
  type AssetId,
  assetIdFromIssuance,
  type Contract,
  IssuanceRecipient,
  type OutPoint,
  type Pset,
  Script,
  TxBuilder,
  XOnlyPublicKey,
} from '@lilbonekit/lwk-web'

import { fetchFeeRateSatPerKvbAbovePending } from '@/api/esplora/fee'
import type { ProtocolBuilderAccess } from '@/lib/wallet/protocolBuilderAccess'
import { AssetKind, buildAssetContract, contractHashOrEmpty } from '@/lwk/assetContract'
import type { UpdatedPset } from '@/lwk/transaction'
import {
  isConfirmedWalletUtxo,
  isPolicyAssetUtxo,
  utxoToOutpointString,
  WALLET_INPUT_RBF_SEQUENCE,
} from '@/lwk/utxo'
import { loadIssuanceFactoryProgram } from '@/simplicity/issuance-factory/program'
import { UNSPENDABLE_TAPROOT_PUBKEY } from '@/simplicity/taproot'
import { formatFeeReserve } from '@/utils/format'
import { bytesToHex } from '@/utils/hex'
import { sha256 } from '@/utils/sha256'
import { toUint8, toUint64 } from '@/utils/uint'

/** What one output has to hold beyond the issuance for this transaction to pay its own fee. */
const BORROWER_ACCOUNT_FEE_RESERVE_SATS = 250n
const ISSUING_UTXOS_COUNT = 2
const REISSUANCE_FLAGS = 0n
const ISSUANCE_AMOUNT = 2n
const REISSUANCE_TOKEN_AMOUNT = 0n
const FACTORY_AUTH_AMOUNT = 1n
const ISSUANCE_FACTORY_AMOUNT = 1n

export interface BorrowerAccountCreationSummary {
  fundingOutpoint: string
  factoryAddress: string
  factoryAuthOutpoint: string
  issuanceFactoryOutpoint: string
  issuedAssetId: string
  metadataOpReturnHex: string
}

/**
 * The builder, with the wallet it acts through given to it rather than read from a hook.
 *
 * Called by a wallet that performs this action for itself. The extension performs it inside
 * itself, from the document, and never reaches this.
 */
export function createFactoryBuilder(access: ProtocolBuilderAccess) {
  const { lwkNetwork, getReceiveAddress, getBlindedWalletUtxos, getWollet, processingTxids } =
    access

  const createBorrowerAccount = async (): Promise<UpdatedPset<BorrowerAccountCreationSummary>> => {
    const receiveAddressString = await getReceiveAddress()

    if (!receiveAddressString) throw new Error('Missing receive address')

    const wollet = await getWollet()
    const policyAsset = lwkNetwork.policyAsset()
    const blindedWalletUtxos = await getBlindedWalletUtxos()

    // The smallest confirmed output that still covers the reserve: the issuance funds itself from
    // one output, and taking the largest would lock up more than the transaction needs.
    const feeUtxo = blindedWalletUtxos
      .filter(utxo => isConfirmedWalletUtxo(utxo) && isPolicyAssetUtxo(utxo, policyAsset))
      .filter(utxo => utxo.unblinded().value() > BORROWER_ACCOUNT_FEE_RESERVE_SATS)
      .sort((a, b) => Number(a.unblinded().value() - b.unblinded().value()))[0]

    if (!feeUtxo) {
      throw new Error(
        `Need a confirmed wallet L-BTC UTXO larger than ${formatFeeReserve(BORROWER_ACCOUNT_FEE_RESERVE_SATS)} to cover the borrower account fee reserve.`,
      )
    }

    if (FACTORY_AUTH_AMOUNT + ISSUANCE_FACTORY_AMOUNT !== ISSUANCE_AMOUNT) {
      throw new Error('Invalid issuance split')
    }

    const fundingOutpoint = utxoToOutpointString(feeUtxo)
    const feeRate = await fetchFeeRateSatPerKvbAbovePending(processingTxids)
    const receiveAddress = Address.parse(receiveAddressString, lwkNetwork).toUnconfidential()
    const issuanceFactoryProgram = loadIssuanceFactoryProgram({
      issuingUtxosCount: toUint8(ISSUING_UTXOS_COUNT, 'issuingUtxosCount'),
      reissuanceFlags: toUint64(REISSUANCE_FLAGS, 'reissuanceFlags'),
    })
    const factoryAddress = issuanceFactoryProgram.createP2trAddress(
      XOnlyPublicKey.fromString(UNSPENDABLE_TAPROOT_PUBKEY),
      lwkNetwork,
    )
    const { contract, issuedAssetId, metadata } = await prepareIssuance(feeUtxo.outpoint())

    const pset = new TxBuilder(lwkNetwork)
      .feeRate(feeRate)
      .setWalletUtxos([feeUtxo.outpoint()])
      .issueAssetToRecipients(
        [
          IssuanceRecipient.fromAddress(FACTORY_AUTH_AMOUNT, receiveAddress),
          IssuanceRecipient.fromAddress(ISSUANCE_FACTORY_AMOUNT, factoryAddress),
        ],
        REISSUANCE_TOKEN_AMOUNT,
        null,
        contract,
      )
      .addPostIssuanceScriptOutput(Script.newOpReturn(metadata), 0n, policyAsset)
      .setInputSequence(feeUtxo.outpoint(), WALLET_INPUT_RBF_SEQUENCE)
      .finish(wollet)

    return {
      pset,
      finalize: (signedPset: Pset) => {
        const finalizedTx = wollet.finalize(signedPset).extractTx()
        const txid = finalizedTx.txid().toString()

        return {
          finalizedTx,
          summary: {
            fundingOutpoint,
            factoryAddress: factoryAddress.toString(),
            // The output order this transaction is built in: the account's auth NFT first, the
            // covenant second. Every later action locates the factory by these two.
            factoryAuthOutpoint: `${txid}:0`,
            issuanceFactoryOutpoint: `${txid}:1`,
            issuedAssetId: issuedAssetId.toString(),
            metadataOpReturnHex: bytesToHex(Script.newOpReturn(metadata).bytes()),
          },
        }
      },
    }
  }

  return { createBorrowerAccount }
}

async function prepareIssuance(fundingOutpoint: OutPoint): Promise<{
  contract: Contract | null
  issuedAssetId: AssetId
  metadata: Uint8Array
}> {
  const contract = buildAssetContract(fundingOutpoint, AssetKind.Factory)

  return {
    contract,
    issuedAssetId: assetIdFromIssuance(fundingOutpoint, await contractHashOrEmpty(contract)),
    metadata: await buildMetadata(),
  }
}

/** What the transaction records about the program it created, for the indexer to recognise it by. */
async function buildMetadata(): Promise<Uint8Array> {
  const { sources } = await import('virtual:simplicity-sources')
  const hash = await sha256(new TextEncoder().encode(sources.issuance_factory))
  const programId = new Uint8Array(hash).slice(0, 4)
  const data = new Uint8Array(13)

  data.set(programId, 0)
  data[4] = ISSUING_UTXOS_COUNT
  new DataView(data.buffer).setBigUint64(5, REISSUANCE_FLAGS, true)

  return data
}
