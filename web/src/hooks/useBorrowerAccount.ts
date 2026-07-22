import {
  Address,
  type AssetId,
  assetIdFromIssuance,
  Contract,
  ContractHash,
  IssuanceRecipient,
  type OutPoint,
  type Pset,
  Script,
  TxBuilder,
  XOnlyPublicKey,
} from '@lilbonekit/lwk-web'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import { fetchFeeRateSatPerKvb } from '@/api/esplora/fee'
import { useFactories } from '@/api/indexer/hooks'
import { factoryQueryKeys } from '@/api/indexer/queryKeys'
import type { FactoryDetails } from '@/api/indexer/schemas'
import type { UpdatedPset } from '@/lwk/transaction'
import { isConfirmedWalletUtxo, isPolicyAssetUtxo, utxoToOutpointString } from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import { loadIssuanceFactoryProgram } from '@/simplicity/issuance-factory/program'
import { UNSPENDABLE_TAPROOT_PUBKEY } from '@/simplicity/taproot'
import { formatFeeReserve } from '@/utils/format'
import { bytesToHex } from '@/utils/hex'
import { sha256 } from '@/utils/sha256'
import { toUint8, toUint64 } from '@/utils/uint'

export interface FactoryState {
  factoryAssetId: string
  factoryAuthOutpoint: string
  issuanceFactoryOutpoint: string
}

function prepareFactory(factory: FactoryDetails): FactoryState | null {
  if (!factory.auth_utxo || !factory.program_utxo) return null
  return {
    factoryAssetId: factory.factory_asset_id,
    factoryAuthOutpoint: `${factory.auth_utxo.txid}:${factory.auth_utxo.vout}`,
    issuanceFactoryOutpoint: `${factory.program_utxo.txid}:${factory.program_utxo.vout}`,
  }
}

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

export function useBorrowerAccount() {
  const { lwkNetwork } = useLwk()
  const { getReceiveAddress, getBlindedWalletUtxos, getWollet, scriptPubkey } = useWallet()
  const queryClient = useQueryClient()
  const factoriesQuery = useFactories(scriptPubkey || '')
  const activeFactory = factoriesQuery.data?.[0] ?? null
  const hasAccount = !!activeFactory

  const factoryState = useMemo(
    () => (activeFactory ? prepareFactory(activeFactory) : null),
    [activeFactory],
  )

  const refetchFactory = useCallback((): void => {
    if (!scriptPubkey) return
    queryClient.invalidateQueries({ queryKey: factoryQueryKeys.byScript(scriptPubkey) })
  }, [scriptPubkey, queryClient])

  const createBorrowerAccount = async (): Promise<UpdatedPset<BorrowerAccountCreationSummary>> => {
    const receiveAddressString = await getReceiveAddress()
    if (!receiveAddressString) throw new Error('Missing receive address')

    const wollet = await getWollet()
    const policyAsset = lwkNetwork.policyAsset()
    const blindedWalletUtxos = await getBlindedWalletUtxos()

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
    const feeRate = await fetchFeeRateSatPerKvb()
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
            factoryAuthOutpoint: `${txid}:0`,
            issuanceFactoryOutpoint: `${txid}:1`,
            issuedAssetId: issuedAssetId.toString(),
            metadataOpReturnHex: bytesToHex(Script.newOpReturn(metadata).bytes()),
          },
        }
      },
    }
  }

  const removeBorrowerAccount = async (): Promise<void> => {
    throw new Error(
      'Remove is scaffolded but not wired: the wallet connector must expose Schnorr signing for IssuanceFactory sig_all_hash.',
    )
  }

  return {
    createBorrowerAccount,
    factoryState,
    refetchFactory,
    hasAccount,
    removeBorrowerAccount,
    scriptPubkey,
  }
}

async function prepareIssuance(fundingOutpoint: OutPoint): Promise<{
  contract: Contract | null
  issuedAssetId: AssetId
  metadata: Uint8Array
}> {
  const contract = buildAssetContract(fundingOutpoint)
  const contractHash = contract ? await contractHashOf(contract) : emptyContractHash()
  return {
    contract,
    issuedAssetId: assetIdFromIssuance(fundingOutpoint, contractHash),
    metadata: await buildMetadata(),
  }
}

function emptyContractHash(): ContractHash {
  return ContractHash.fromBytes(new Uint8Array(32))
}

/**
 * The ELIP-0100 asset contract committed into the factory asset issuance so its metadata is verifiable against
 * the asset id and registrable in the asset registry.
 *
 * Fully stateless, nothing is supplied by the user or by build configuration, so the backend derives the
 * identical contract with no interaction.
 *
 * The backend is the authority. It re-derives this contract while indexing the creation
 * transaction (`expected_contract` in `crates/indexer/src/indexer/asset_registration.rs`) and
 * only a matching commitment gets registered and a domain proof.
 */
function buildAssetContract(fundingOutpoint: OutPoint): Contract | null {
  const domain = window.location.hostname.toLowerCase()
  if (!domain.includes('.')) return null

  const txid = fundingOutpoint.txid().toString()
  try {
    return new Contract(
      domain,
      `02${UNSPENDABLE_TAPROOT_PUBKEY}`,
      `simplicity-lending/v1 ${txid}:${fundingOutpoint.vout()}`,
      0,
      // Max 7 chars: hardware wallets hold tickers in 8-byte buffers
      // incl. NUL (e.g. Jade's sign_tx.c ticker[8]).
      `SLF${txid.slice(0, 4)}`,
      0,
    )
  } catch {
    return null
  }
}

/** SHA-256 of the contract's canonical (key-sorted) JSON serialization. */
async function contractHashOf(contract: Contract): Promise<ContractHash> {
  const digest = await sha256(new TextEncoder().encode(contract.toString()))
  return ContractHash.fromBytes(new Uint8Array(digest))
}

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
