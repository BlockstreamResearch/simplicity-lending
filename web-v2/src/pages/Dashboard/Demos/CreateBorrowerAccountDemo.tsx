import {
  Address,
  assetIdFromIssuance,
  ContractHash,
  IssuanceRecipient,
  Script,
  TxBuilder,
  type XOnlyPublicKey,
} from 'lwk_web'
import { useState } from 'react'

import { broadcastTx } from '@/api/esplora/methods'
import { getTxExplorerUrl } from '@/api/esplora/utils'
import { isPolicyAssetUtxo, utxoToOutpointString } from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import { loadIssuanceFactoryProgram } from '@/simplicity/issuance-factory/program'
import { bytesToHex } from '@/utils/hex'

import { useTxConfirmations } from './helpers'

interface CreateBorrowerAccountSummary {
  fundingOutpoint: string
  factoryAddress: string
  factoryAuthOutpoint: string
  issuanceFactoryOutpoint: string
  issuedAssetId: string
  issuanceAmount: string
  reissuanceTokenAmount: string
  metadataOpReturnHex: string
  metadataIncluded: boolean
}

interface RemoveBorrowerAccountSummary {
  factoryOutpoint: string
}

interface BorrowerAccountState {
  creationTxid: string
  factoryAddress: string
  factoryAuthOutpoint: string
  issuanceFactoryOutpoint: string
  issuedAssetId: string
  metadataOpReturnHex: string
}

interface BroadcastState<TSummary> {
  busy: boolean
  error: string | null
  summary: TSummary | null
  txid: string | null
}

const BORROWER_ACCOUNT_STORAGE_KEY = 'borrower-account-demo'
const DEFAULT_FEE_RESERVE = 10_000n
const ISSUING_UTXOS_COUNT = 2
const REISSUANCE_FLAGS = 0n
const ISSUANCE_AMOUNT = 2n
const REISSUANCE_TOKEN_AMOUNT = 0n
const FACTORY_AUTH_AMOUNT = 1n
const ISSUANCE_FACTORY_AMOUNT = 1n

const INITIAL_BROADCAST_STATE = {
  busy: false,
  error: null,
  summary: null,
  txid: null,
}

export default function CreateBorrowerAccountDemo() {
  const { lwkNetwork } = useLwk()
  const {
    connectionStatus,
    getReceiveAddress,
    getWalletUtxos,
    getWollet,
    getXOnlyPublicKey,
    signPset,
  } = useWallet()

  const [xOnlyPublicKey, setXOnlyPublicKey] = useState<XOnlyPublicKey | null>(null)
  const [createState, setCreateState] = useState<BroadcastState<CreateBorrowerAccountSummary>>({
    ...INITIAL_BROADCAST_STATE,
  })
  const [removeState, setRemoveState] = useState<BroadcastState<RemoveBorrowerAccountSummary>>({
    ...INITIAL_BROADCAST_STATE,
  })

  const createConfirmations = useTxConfirmations(createState.txid)
  const removeConfirmations = useTxConfirmations(removeState.txid)

  const createBorrowerAccount = async () => {
    setCreateState(state => ({
      ...state,
      busy: true,
      error: null,
      summary: null,
      txid: null,
    }))

    try {
      const key = await getXOnlyPublicKey()
      if (!key) {
        throw new Error('Missing x-only public key')
      }
      setXOnlyPublicKey(key)

      const receiveAddressString = await getReceiveAddress()
      if (!receiveAddressString) {
        throw new Error('Missing receive address')
      }

      const wollet = await getWollet()

      const policyAsset = lwkNetwork.policyAsset()
      const walletUtxos = await getWalletUtxos()
      const feeUtxo = walletUtxos
        .filter(utxo => isPolicyAssetUtxo(utxo, policyAsset))
        .filter(utxo => utxo.unblinded().value() > DEFAULT_FEE_RESERVE)
        .sort((a, b) => Number(a.unblinded().value() - b.unblinded().value()))[0]

      if (!feeUtxo) {
        throw new Error('Need a wallet L-BTC UTXO larger than the fee reserve')
      }

      const fundingOutpoint = utxoToOutpointString(feeUtxo)
      const receiveAddress = Address.parse(receiveAddressString, lwkNetwork).toUnconfidential()
      const issuanceFactoryProgram = loadIssuanceFactoryProgram({
        issuingUtxosCount: ISSUING_UTXOS_COUNT,
        reissuanceFlags: REISSUANCE_FLAGS,
      })
      const factoryAddress = issuanceFactoryProgram.createP2trAddress(key, lwkNetwork)
      const factoryAddressString = factoryAddress.toString()
      const issuedAssetId = assetIdFromIssuance(feeUtxo.outpoint(), emptyContractHash())

      const metadata = await buildIssuanceFactoryMetadata()

      if (FACTORY_AUTH_AMOUNT + ISSUANCE_FACTORY_AMOUNT !== ISSUANCE_AMOUNT) {
        throw new Error('invalid issuance split')
      }

      const issuanceRecipients = [
        IssuanceRecipient.fromAddress(FACTORY_AUTH_AMOUNT, receiveAddress),
        IssuanceRecipient.fromAddress(ISSUANCE_FACTORY_AMOUNT, factoryAddress),
      ]

      const pset = new TxBuilder(lwkNetwork)
        .setWalletUtxos([feeUtxo.outpoint()])
        .issueAssetToRecipients(issuanceRecipients, REISSUANCE_TOKEN_AMOUNT, null, null)
        .addExplicitScriptOutput(Script.newOpReturn(metadata), 0n, policyAsset)
        .finish(wollet)

      const signedPset = await signPset(pset)
      const finalizedPset = wollet.finalize(signedPset)
      const tx = finalizedPset.extractTx()
      const creationTxid = await broadcastTx(tx.toString())

      const savedState: BorrowerAccountState = {
        creationTxid,
        factoryAddress: factoryAddressString,
        factoryAuthOutpoint: `${creationTxid}:0`,
        issuanceFactoryOutpoint: `${creationTxid}:1`,
        issuedAssetId: issuedAssetId.toString(),
        metadataOpReturnHex: bytesToHex(Script.newOpReturn(metadata).bytes()),
      }
      saveBorrowerAccountState(savedState)

      setCreateState({
        busy: false,
        error: null,
        summary: {
          fundingOutpoint,
          factoryAddress: savedState.factoryAddress,
          factoryAuthOutpoint: savedState.factoryAuthOutpoint,
          issuanceFactoryOutpoint: savedState.issuanceFactoryOutpoint,
          issuedAssetId: savedState.issuedAssetId,
          issuanceAmount: ISSUANCE_AMOUNT.toString(),
          reissuanceTokenAmount: REISSUANCE_TOKEN_AMOUNT.toString(),
          metadataOpReturnHex: savedState.metadataOpReturnHex,
          metadataIncluded: true,
        },
        txid: creationTxid,
      })
    } catch (err) {
      setCreateState(state => ({
        ...state,
        busy: false,
        error: err instanceof Error ? err.message : String(err),
      }))
    }
  }

  const removeBorrowerAccount = async () => {
    setRemoveState(state => ({
      ...state,
      busy: true,
      error: null,
      summary: null,
      txid: null,
    }))

    try {
      if (!latestBorrowerAccountState()) {
        throw new Error('Create a borrower account first')
      }

      throw new Error(
        'Remove is scaffolded but not wired: the wallet connector must expose Schnorr signing for IssuanceFactory sig_all_hash.',
      )
    } catch (err) {
      setRemoveState(state => ({
        ...state,
        busy: false,
        error: err instanceof Error ? err.message : String(err),
      }))
    }
  }

  const busy = createState.busy || removeState.busy
  const disabled = connectionStatus !== 'ready' || busy

  return (
    <div className='space-y-4'>
      <div className='rounded border border-gray-300 bg-white p-4'>
        <div className='font-bold'>Borrower Account IssuanceFactory Demo</div>
        <p className='mt-2 max-w-3xl text-sm text-gray-600'>
          Creates a borrower account by issuing two units of a new auth asset from one wallet L-BTC
          input. One unit returns to the user as FactoryAuth, and one unit funds the IssuanceFactory
          covenant. Reissuance token amount is zero.
        </p>

        <div className='mt-4 flex flex-wrap gap-2'>
          <button
            className='rounded bg-accent-soft-hover px-4 py-2 text-sm disabled:opacity-50'
            disabled={disabled}
            onClick={createBorrowerAccount}
          >
            {createState.busy ? 'Creating borrower account…' : 'Create Borrower Account'}
          </button>

          <button
            className='rounded border border-gray-300 px-4 py-2 text-sm disabled:opacity-50'
            disabled={disabled}
            onClick={removeBorrowerAccount}
          >
            {removeState.busy ? 'Removing borrower account…' : 'Remove Borrower Account'}
          </button>
        </div>

        {createState.error && (
          <p className='mt-3 text-xs text-red-500'>Create: {createState.error}</p>
        )}
        {removeState.error && (
          <p className='mt-3 text-xs text-red-500'>Remove: {removeState.error}</p>
        )}

        <div className='mt-4 grid gap-4'>
          <BroadcastResult
            title='Borrower Account Created'
            txid={createState.txid}
            confirmations={createConfirmations}
            summary={createState.summary ?? undefined}
          />

          <BroadcastResult
            title='Borrower Account Removed'
            txid={removeState.txid}
            confirmations={removeConfirmations}
            summary={removeState.summary ?? undefined}
          />
        </div>

        <pre className='mt-4 overflow-x-auto rounded bg-gray-100 p-4 text-sm'>
          {JSON.stringify(
            {
              connectionStatus,
              hasPubkey: !!xOnlyPublicKey,
              latestSavedState: latestBorrowerAccountState(),
              constants: {
                issuingUtxosCount: ISSUING_UTXOS_COUNT,
                reissuanceFlags: REISSUANCE_FLAGS.toString(),
                issuanceAmount: ISSUANCE_AMOUNT.toString(),
                reissuanceTokenAmount: REISSUANCE_TOKEN_AMOUNT.toString(),
              },
              create: {
                broadcasting: createState.busy,
                txid: createState.txid,
                confirmations: createConfirmations,
                error: createState.error,
              },
              remove: {
                broadcasting: removeState.busy,
                txid: removeState.txid,
                confirmations: removeConfirmations,
                error: removeState.error,
              },
            },
            null,
            2,
          )}
        </pre>
      </div>
    </div>
  )
}

async function buildIssuanceFactoryMetadata(): Promise<Uint8Array> {
  const programId = await getIssuanceFactoryProgramId()
  const data = new Uint8Array(13)
  data.set(programId, 0)
  data[4] = ISSUING_UTXOS_COUNT
  new DataView(data.buffer).setBigUint64(5, REISSUANCE_FLAGS, true)
  return data
}

function emptyContractHash(): ContractHash {
  return ContractHash.fromBytes(new Uint8Array(32))
}

async function getIssuanceFactoryProgramId(): Promise<Uint8Array> {
  const { sources } = await import('virtual:simplicity-sources')
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(sources.issuance_factory),
  )
  return new Uint8Array(hash).slice(0, 4)
}

function getBorrowerAccountStates(): BorrowerAccountState[] {
  const raw = localStorage.getItem(BORROWER_ACCOUNT_STORAGE_KEY)
  if (!raw) {
    return []
  }

  return JSON.parse(raw)
}

function latestBorrowerAccountState(): BorrowerAccountState | null {
  const states = getBorrowerAccountStates()
  return states[states.length - 1] ?? null
}

function saveBorrowerAccountState(state: BorrowerAccountState): void {
  const existingStates = getBorrowerAccountStates()
  existingStates.push(state)
  localStorage.setItem(BORROWER_ACCOUNT_STORAGE_KEY, JSON.stringify(existingStates))
}

function BroadcastResult({
  title,
  txid,
  confirmations,
  summary,
}: {
  title: string
  txid: string | null
  confirmations: number | null
  summary?: unknown
}) {
  if (!txid) {
    return null
  }

  return (
    <div className='rounded border border-gray-200 p-3'>
      <div className='font-semibold'>{title}</div>
      <a
        className='break-all text-sm text-blue-600 underline'
        href={getTxExplorerUrl(txid)}
        rel='noreferrer'
        target='_blank'
      >
        {txid}
      </a>
      <div className='mt-1 text-xs text-gray-600'>
        Confirmations: {confirmations === null ? 'waiting…' : confirmations}
      </div>
      {summary ? (
        <pre className='mt-2 overflow-x-auto rounded bg-gray-100 p-2 text-xs'>
          {JSON.stringify(summary, null, 2)}
        </pre>
      ) : null}
    </div>
  )
}
