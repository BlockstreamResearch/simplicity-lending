// This file is a temporary playground for testing ScriptAuth covenants in a real wallet environment.
// It is not intended to be a long-term part of the codebase, and may be deleted or significantly refactored in the future.
// The demo performs the following steps:
// 1. User clicks "Fund Covenant UTXO" button and waits at least 1 confirmation
// 2. User clicks "Spend Covenant UTXO" button, which attempts to spend the covenant UTXO using the auth UTXO and logs the result
import {
  Address,
  ExternalUtxo,
  SimplicityLogLevel,
  Transaction,
  TxBuilder,
  TxOutSecrets,
  type XOnlyPublicKey,
} from 'lwk_web'
import { useState } from 'react'

import { broadcastTx, fetchAddressUtxo, fetchTxRaw } from '@/api/esplora/methods'
import { getTxExplorerUrl } from '@/api/esplora/utils'
import { utxoToOutpointString } from '@/lwk/utxo'
import {
  latestScriptAuthState,
  saveScriptAuthState,
  selectDemoScriptAuthInputs,
  useTxConfirmations,
} from '@/pages/Dashboard/Demos/helpers'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import { buildScriptAuthWitness, loadScriptAuthProgram } from '@/simplicity/script-auth/program'
import { hexToBytes } from '@/utils/hex'
import { toBytes32, toUint32 } from '@/utils/uint'

interface FundingSummary {
  covenantAddress: string
  fundingOutpoint: string
  authOutpoint: string
  scriptHashHex: string
  amount: string
}

interface SpendSummary {
  covenantOutpoint: string
  authOutpoint: string
  recipientAddress: string
  amount: string
}

interface BroadcastState<TSummary> {
  busy: boolean
  error: string | null
  summary: TSummary | null
  txid: string | null
}

const DEFAULT_SCRIPT_AUTH_FEE_RATE = 100
const DEFAULT_SCRIPT_AUTH_FEE_RESERVE = 10_000n
const DEFAULT_EXTERNAL_UTXO_MAX_WEIGHT_TO_SATISFY = 20_000

const INITIAL_BROADCAST_STATE = {
  busy: false,
  error: null,
  summary: null,
  txid: null,
}

export default function ScriptAuthCovenantDemo() {
  const { lwkNetwork } = useLwk()
  const {
    connectionStatus,
    getXOnlyPublicKey,
    getReceiveAddress,
    getWalletUtxos,
    getWollet,
    signPset,
  } = useWallet()

  const [xOnlyPublicKey, setXOnlyPublicKey] = useState<XOnlyPublicKey | null>(null)

  const [fundingState, setFundingState] = useState<BroadcastState<FundingSummary>>({
    ...INITIAL_BROADCAST_STATE,
  })
  const [spendState, setSpendState] = useState<BroadcastState<SpendSummary>>({
    ...INITIAL_BROADCAST_STATE,
  })

  const fundingConfirmations = useTxConfirmations(fundingState.txid)
  const spendConfirmations = useTxConfirmations(spendState.txid)

  const fundCovenant = async () => {
    setFundingState(state => ({
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

      const walletUtxos = await getWalletUtxos()
      const policyAsset = lwkNetwork.policyAsset()
      const { authUtxo, fundingUtxo } = selectDemoScriptAuthInputs(
        walletUtxos,
        policyAsset,
        DEFAULT_SCRIPT_AUTH_FEE_RESERVE,
      )
      const scriptHashHex = authUtxo.scriptPubkey().jet_sha256_hex()
      const scriptAuthProgram = loadScriptAuthProgram(
        toBytes32(hexToBytes(scriptHashHex), 'scriptHash'),
      )
      const scriptAuthAddress = scriptAuthProgram.createP2trAddress(key, lwkNetwork)
      const covenantAddress = scriptAuthAddress.toString()

      const fundingAmount = fundingUtxo.unblinded().value() - DEFAULT_SCRIPT_AUTH_FEE_RESERVE
      const fundingOutpoint = utxoToOutpointString(fundingUtxo)

      const authOutpoint = utxoToOutpointString(authUtxo)

      const wollet = await getWollet()

      const fundingPset = new TxBuilder(lwkNetwork)
        .feeRate(DEFAULT_SCRIPT_AUTH_FEE_RATE)
        .setWalletUtxos([fundingUtxo.outpoint()])
        .addExplicitRecipient(scriptAuthAddress, fundingAmount, policyAsset)
        .finish(wollet)

      const signedPset = await signPset(fundingPset)
      const finalizedPset = wollet.finalize(signedPset)
      const fundingTx = finalizedPset.extractTx()
      const fundingTxid = await broadcastTx(fundingTx.toString())

      saveScriptAuthState({
        authOutpoint,
        scriptHashHex,
        fundingTxid,
      })

      setFundingState({
        busy: false,
        error: null,
        summary: {
          covenantAddress,
          fundingOutpoint,
          authOutpoint,
          scriptHashHex,
          amount: fundingAmount.toString(),
        },
        txid: fundingTxid,
      })
    } catch (err) {
      setFundingState(state => ({
        ...state,
        busy: false,
        error: err instanceof Error ? err.message : String(err),
      }))
    }
  }

  const spendCovenantUtxo = async () => {
    setSpendState(state => ({
      ...state,
      busy: true,
      error: null,
      summary: null,
      txid: null,
    }))

    try {
      const scriptAuthState = latestScriptAuthState()
      if (!scriptAuthState) {
        throw new Error('Failed to prepare ScriptAuth state')
      }
      const { scriptHashHex } = scriptAuthState

      const scriptAuthProgram = loadScriptAuthProgram(
        toBytes32(hexToBytes(scriptHashHex), 'scriptHash'),
      )
      const key = xOnlyPublicKey ?? (await getXOnlyPublicKey())
      if (!key) {
        throw new Error('Missing x-only public key')
      }
      setXOnlyPublicKey(key)

      const scriptAuthAddress = scriptAuthProgram.createP2trAddress(key, lwkNetwork)
      const scriptAuthAddressString = scriptAuthAddress.toString()

      const covenantUtxos = await fetchAddressUtxo(scriptAuthAddressString)
      const covenantUtxo =
        covenantUtxos.find(utxo => utxo.txid === scriptAuthState.fundingTxid) ?? covenantUtxos[0]
      if (!covenantUtxo) {
        throw new Error('ScriptAuth covenant UTXO not found')
      }

      const walletUtxos = await getWalletUtxos()

      const authUtxo =
        walletUtxos.find(utxo => utxoToOutpointString(utxo) === scriptAuthState.authOutpoint) ??
        null
      if (!authUtxo) {
        throw new Error('ScriptAuth auth UTXO not found')
      }
      const authOutpointString = utxoToOutpointString(authUtxo)
      const covenantOutpoint = `${covenantUtxo.txid}:${covenantUtxo.vout}`

      const covenantTx = Transaction.fromBytes(await fetchTxRaw(covenantUtxo.txid))
      const covenantTxOut = covenantTx.outputs[covenantUtxo.vout]
      if (!covenantTxOut) {
        throw new Error('ScriptAuth covenant funding transaction does not have the UTXO output')
      }

      const authOutpoint = authUtxo.outpoint()
      const authTx = Transaction.fromBytes(await fetchTxRaw(authOutpoint.txid().toString()))
      const authTxOut = authTx.outputs[authOutpoint.vout()]

      if (!authTxOut) {
        throw new Error('ScriptAuth auth transaction does not have the selected output')
      }

      const policyAsset = lwkNetwork.policyAsset()
      const covenantValue = covenantUtxo.value

      if (!covenantValue) {
        throw new Error('ScriptAuth covenant UTXO value is missing')
      }

      const covenantExternalUtxo = new ExternalUtxo(
        covenantUtxo.vout,
        covenantTx,
        TxOutSecrets.fromExplicit(policyAsset, BigInt(covenantValue)),
        DEFAULT_EXTERNAL_UTXO_MAX_WEIGHT_TO_SATISFY,
        true,
      )

      const receiveAddress = await getReceiveAddress()
      if (!receiveAddress) {
        throw new Error('Missing receive address')
      }

      const wollet = await getWollet()

      const recipientAddress = Address.parse(receiveAddress, lwkNetwork).toUnconfidential()
      const recipientAddressString = recipientAddress.toString()
      const spendPset = new TxBuilder(lwkNetwork)
        .feeRate(DEFAULT_SCRIPT_AUTH_FEE_RATE)
        .setWalletUtxos([authOutpoint])
        .addExternalUtxos([covenantExternalUtxo])
        .addExplicitRecipient(recipientAddress, BigInt(covenantValue), policyAsset)
        .finish(wollet)

      const signedSpendPset = await signPset(spendPset)
      const finalizedWalletPset = wollet.finalize(signedSpendPset)
      const txWithWalletWitness = finalizedWalletPset.extractTx()

      const COVENANT_INPUT_INDEX = 0
      const AUTH_INPUT_INDEX = 1

      const finalizedTx = scriptAuthProgram.finalizeTransaction(
        txWithWalletWitness,
        key,
        [covenantTxOut, authTxOut],
        COVENANT_INPUT_INDEX,
        buildScriptAuthWitness(toUint32(AUTH_INPUT_INDEX, 'authInputIndex')),
        lwkNetwork,
        SimplicityLogLevel.Trace,
      )

      const spendTxid = await broadcastTx(finalizedTx.toString())

      setSpendState({
        busy: false,
        error: null,
        summary: {
          covenantOutpoint,
          authOutpoint: authOutpointString,
          recipientAddress: recipientAddressString,
          amount: covenantValue.toString(),
        },
        txid: spendTxid,
      })
    } catch (err) {
      setSpendState(state => ({
        ...state,
        busy: false,
        error: err instanceof Error ? err.message : String(err),
      }))
    }
  }

  const busy = fundingState.busy || spendState.busy
  const disabled = connectionStatus !== 'ready' || busy

  return (
    <div className='space-y-4'>
      <div className='rounded border border-gray-300 bg-white p-4'>
        <div className='font-bold'>ScriptAuth Covenant Smoke Test</div>

        <div className='mt-4 flex flex-wrap gap-2'>
          <button
            className='rounded bg-accent-soft-hover px-4 py-2 text-sm disabled:opacity-50'
            disabled={disabled}
            onClick={fundCovenant}
          >
            {fundingState.busy ? 'Funding covenant…' : 'Fund Covenant UTXO'}
          </button>

          <button
            className='rounded border border-gray-300 px-4 py-2 text-sm disabled:opacity-50'
            disabled={disabled}
            onClick={spendCovenantUtxo}
          >
            {spendState.busy ? 'Spending covenant…' : 'Spend Covenant UTXO'}
          </button>
        </div>

        {fundingState.error && (
          <p className='mt-3 text-xs text-red-500'>Funding: {fundingState.error}</p>
        )}
        {spendState.error && <p className='mt-3 text-xs text-red-500'>Spend: {spendState.error}</p>}

        <div className='mt-4 grid gap-4'>
          <BroadcastResult
            title='Funding Broadcasted'
            txid={fundingState.txid}
            confirmations={fundingConfirmations}
            summary={fundingState.summary ?? undefined}
          />

          <BroadcastResult
            title='Spend Broadcasted'
            txid={spendState.txid}
            confirmations={spendConfirmations}
            summary={spendState.summary ?? undefined}
          />
        </div>

        <pre className='mt-4 rounded bg-gray-100 p-4 text-sm overflow-x-auto'>
          {JSON.stringify(
            {
              connectionStatus,
              hasPubkey: !!xOnlyPublicKey,
              latestSavedState: latestScriptAuthState(),
              funding: {
                broadcasting: fundingState.busy,
                txid: fundingState.txid,
                confirmations: fundingConfirmations,
                error: fundingState.error,
              },
              spend: {
                broadcasting: spendState.busy,
                txid: spendState.txid,
                confirmations: spendConfirmations,
                error: spendState.error,
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
    <div className='rounded border border-green-500 bg-green-50 p-4'>
      <div className='font-bold'>{title}</div>

      <div className='mt-2 break-all'>TXID: {txid}</div>

      <a
        href={getTxExplorerUrl(txid)}
        target='_blank'
        rel='noopener noreferrer'
        className='mt-2 block text-blue-600 underline'
      >
        Open in Explorer
      </a>

      <p className='mt-2 text-xs text-gray-500'>
        {confirmations !== null
          ? `${confirmations} confirmation${confirmations === 1 ? '' : 's'}`
          : 'Waiting for confirmation...'}
      </p>

      {summary !== undefined && (
        <pre className='mt-3 rounded bg-white/70 p-3 text-xs overflow-x-auto'>
          {JSON.stringify(summary, null, 2)}
        </pre>
      )}
    </div>
  )
}
