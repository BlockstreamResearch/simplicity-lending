import { useQueryClient } from '@tanstack/react-query'
import {
  Address,
  assetIdFromIssuance,
  ContractHash,
  IssuanceRecipient,
  Script,
  TxBuilder,
  XOnlyPublicKey,
} from 'lwk_web'
import { useCallback, useMemo } from 'react'

import { broadcastTx } from '@/api/esplora/methods'
import { useFactories } from '@/api/indexer/hooks'
import { factoryQueryKeys } from '@/api/indexer/queryKeys'
import type { FactoryDetails } from '@/api/indexer/schemas'
import { isPolicyAssetUtxo, utxoToOutpointString } from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import { loadIssuanceFactoryProgram } from '@/simplicity/issuance-factory/program'
import { UNSPENDABLE_TAPROOT_PUBKEY } from '@/simplicity/taproot'
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

const FEE_RESERVE = 250n
const ISSUING_UTXOS_COUNT = 2
const REISSUANCE_FLAGS = 0n
const ISSUANCE_AMOUNT = 2n
const REISSUANCE_TOKEN_AMOUNT = 0n
const FACTORY_AUTH_AMOUNT = 1n
const ISSUANCE_FACTORY_AMOUNT = 1n

export interface BorrowerAccountCreationResult {
  txid: string
  fundingOutpoint: string
  factoryAddress: string
  factoryAuthOutpoint: string
  issuanceFactoryOutpoint: string
  issuedAssetId: string
  metadataOpReturnHex: string
}

export function useBorrowerAccount() {
  const { lwkNetwork } = useLwk()
  const { getReceiveAddress, getBlindedWalletUtxos, getWollet, signPset, scriptPubkey } =
    useWallet()
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

  const createBorrowerAccount = async (): Promise<BorrowerAccountCreationResult> => {
    const receiveAddressString = await getReceiveAddress()
    if (!receiveAddressString) throw new Error('Missing receive address')

    const wollet = await getWollet()
    const policyAsset = lwkNetwork.policyAsset()
    const blindedWalletUtxos = await getBlindedWalletUtxos()

    const feeUtxo = blindedWalletUtxos
      .filter(utxo => isPolicyAssetUtxo(utxo, policyAsset))
      .filter(utxo => utxo.unblinded().value() > FEE_RESERVE)
      .sort((a, b) => Number(a.unblinded().value() - b.unblinded().value()))[0]

    if (!feeUtxo) throw new Error('Need a wallet L-BTC UTXO larger than the fee reserve')

    if (FACTORY_AUTH_AMOUNT + ISSUANCE_FACTORY_AMOUNT !== ISSUANCE_AMOUNT) {
      throw new Error('Invalid issuance split')
    }

    const fundingOutpoint = utxoToOutpointString(feeUtxo)
    const receiveAddress = Address.parse(receiveAddressString, lwkNetwork).toUnconfidential()
    const issuanceFactoryProgram = loadIssuanceFactoryProgram({
      issuingUtxosCount: toUint8(ISSUING_UTXOS_COUNT, 'issuingUtxosCount'),
      reissuanceFlags: toUint64(REISSUANCE_FLAGS, 'reissuanceFlags'),
    })
    const factoryAddress = issuanceFactoryProgram.createP2trAddress(
      XOnlyPublicKey.fromString(UNSPENDABLE_TAPROOT_PUBKEY),
      lwkNetwork,
    )
    const issuedAssetId = assetIdFromIssuance(feeUtxo.outpoint(), emptyContractHash())
    const metadata = await buildMetadata()

    const pset = new TxBuilder(lwkNetwork)
      .setWalletUtxos([feeUtxo.outpoint()])
      .issueAssetToRecipients(
        [
          IssuanceRecipient.fromAddress(FACTORY_AUTH_AMOUNT, receiveAddress),
          IssuanceRecipient.fromAddress(ISSUANCE_FACTORY_AMOUNT, factoryAddress),
        ],
        REISSUANCE_TOKEN_AMOUNT,
        null,
        null,
      )
      .addPostIssuanceScriptOutput(Script.newOpReturn(metadata), 0n, policyAsset)
      .finish(wollet)

    const signedPset = await signPset(pset)
    const finalizedPset = wollet.finalize(signedPset)
    const txid = await broadcastTx(finalizedPset.extractTx().toString())

    const result: BorrowerAccountCreationResult = {
      txid,
      fundingOutpoint,
      factoryAddress: factoryAddress.toString(),
      factoryAuthOutpoint: `${txid}:0`,
      issuanceFactoryOutpoint: `${txid}:1`,
      issuedAssetId: issuedAssetId.toString(),
      metadataOpReturnHex: bytesToHex(Script.newOpReturn(metadata).bytes()),
    }

    // Optimistic update: indexer lag means the factory won't appear in API for several seconds
    queryClient.setQueryData<FactoryDetails[]>(
      factoryQueryKeys.byScript(scriptPubkey ?? ''),
      old => [
        ...(old ?? []),
        {
          id: result.txid,
          factory_asset_id: result.issuedAssetId,
          program_script_pubkey: result.factoryAddress,
          status: 'active',
          issuing_utxos_count: ISSUING_UTXOS_COUNT,
          reissuance_flags: REISSUANCE_FLAGS,
          created_at_height: 0,
          created_at_txid: result.txid,
          auth_utxo: {
            txid: result.txid,
            vout: 0,
            script_pubkey: scriptPubkey ?? '',
            created_at_height: 0,
          },
          program_utxo: {
            txid: result.txid,
            vout: 1,
            created_at_height: 0,
          },
        },
      ],
    )
    queryClient.invalidateQueries({ queryKey: factoryQueryKeys.byScript(scriptPubkey ?? '') })

    return result
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
  }
}

function emptyContractHash(): ContractHash {
  return ContractHash.fromBytes(new Uint8Array(32))
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
