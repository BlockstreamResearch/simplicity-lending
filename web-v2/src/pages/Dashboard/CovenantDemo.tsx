import {
  Address,
  ExternalUtxo,
  type Pset,
  Transaction,
  TxOutSecrets,
  type WalletTxOut,
  type XOnlyPublicKey,
} from 'lwk_web'
import { useEffect, useState } from 'react'
import { sources } from 'virtual:simplicity-sources'

import { fetchAddressUtxo, fetchTxConfirmations, fetchTxRaw } from '@/api/esplora/methods'
import { getTxExplorerUrl } from '@/api/esplora/utils'
import { buildExplicitRecipientPset, buildExternalExplicitRecipientPset } from '@/lib/pset-builder'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import { loadScriptAuthProgram } from '@/simplicity/covenants/scriptAuth'

interface CovenantResult {
  sourceLoaded: boolean
  xOnlyPublicKey: string
  receiveAddress: string
  scriptHash: number[]
  address: string
  cmr: string
  txOutputs: TxOutputSummary[]
  utxos: {
    covenant: unknown[]
    wallet: WalletUtxoSummary[]
  }
}

interface WalletUtxoSummary {
  outpoint: string
  address: string
  asset: string
  value: string
  wildcardIndex: number
}

interface TxOutputSummary {
  asset?: string
  amount?: string
  script: string
}

function summarizeWalletUtxo(utxo: WalletTxOut): WalletUtxoSummary {
  const outpoint = utxo.outpoint()
  const unblinded = utxo.unblinded()

  return {
    outpoint: `${outpoint.txid().toString()}:${outpoint.vout()}`,
    address: utxo.address().toString(),
    asset: unblinded.asset().toString(),
    value: unblinded.value().toString(),
    wildcardIndex: utxo.wildcardIndex(),
  }
}

export default function CovenantDemo() {
  const { lwkNetwork } = useLwk()

  const {
    connectionStatus,
    getXOnlyPublicKey,
    getReceiveAddress,
    getWalletUtxos,
    getWollet,
    signAndBroadcast,
  } = useWallet()

  const [xOnlyPublicKey, setXOnlyPublicKey] = useState<XOnlyPublicKey | null>(null)

  const [result, setResult] = useState<CovenantResult | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [pset, setPset] = useState<Pset | null>(null)
  const [psetString, setPsetString] = useState<string | null>(null)
  const [broadcasting, setBroadcasting] = useState(false)
  const [broadcastTxid, setBroadcastTxid] = useState<string | null>(null)
  const [broadcastError, setBroadcastError] = useState<string | null>(null)
  const [txConfirmations, setTxConfirmations] = useState<number | null>(null)

  useEffect(() => {
    if (connectionStatus !== 'ready') {
      return
    }

    let cancelled = false

    async function run(): Promise<void> {
      try {
        setError(null)
        setXOnlyPublicKey(null)
        setResult(null)
        setPset(null)
        setPsetString(null)
        setBroadcastTxid(null)
        setBroadcastError(null)
        setTxConfirmations(null)

        const key = await getXOnlyPublicKey()

        if (!key) {
          throw new Error('Missing x-only public key')
        }

        const receiveAddress = await getReceiveAddress()

        if (!receiveAddress) {
          throw new Error('Missing receive address')
        }

        const parsedAddress = Address.parse(receiveAddress, lwkNetwork)

        const scriptHashHex = parsedAddress.scriptPubkey().jet_sha256_hex()

        const scriptHash = Uint8Array.from(
          scriptHashHex.match(/.{1,2}/g)!.map(byte => Number.parseInt(byte, 16)),
        )

        const scriptAuthProgram = loadScriptAuthProgram(scriptHash)

        const covenantAddress = scriptAuthProgram.createP2trAddress(key, lwkNetwork)

        const covenantUtxos = await fetchAddressUtxo(covenantAddress.toString())
        const walletUtxos = await getWalletUtxos()
        const policyAsset = lwkNetwork.policyAsset().toString()
        const walletUtxo = walletUtxos.find(
          utxo => utxo.unblinded().asset().toString() === policyAsset,
        )

        if (!walletUtxo) {
          throw new Error('Missing wallet L-BTC UTXO')
        }

        const walletUtxoValue = walletUtxo.unblinded().value()
        const feeReserve = 10_000n
        const feeRate = 100

        if (walletUtxoValue <= feeReserve) {
          throw new Error('Selected wallet L-BTC UTXO is too small for fee reserve')
        }

        const builtPset = buildExplicitRecipientPset({
          wollet: getWollet(),
          network: lwkNetwork,
          recipientAddress: covenantAddress.toString(),
          outpoints: [walletUtxo.outpoint()],
          satoshi: walletUtxoValue - feeReserve,
          feeRate,
        })
        const psetString = builtPset.toString()

        const tx = builtPset.extractTx()

        const txOutputs = tx.outputs.map(
          (output): TxOutputSummary => ({
            asset: output?.asset()?.toString(),
            amount: output.value()?.toString(),
            script: output.scriptPubkey().toString(),
          }),
        )

        if (cancelled) {
          return
        }

        setXOnlyPublicKey(key)
        setPset(builtPset)
        setPsetString(psetString)

        setResult({
          sourceLoaded: !!sources.script_auth,

          xOnlyPublicKey: key.toString(),

          receiveAddress,

          scriptHash: Array.from(scriptHash),

          address: covenantAddress.toString(),

          cmr: scriptAuthProgram.cmr.toString(),

          txOutputs,

          utxos: {
            covenant: covenantUtxos,
            wallet: walletUtxos.map(summarizeWalletUtxo),
          },
        })
      } catch (err) {
        if (!cancelled) {
          setError(String(err))
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [
    connectionStatus,
    getReceiveAddress,
    getWollet,
    getWalletUtxos,
    getXOnlyPublicKey,
    lwkNetwork,
  ])

  useEffect(() => {
    if (!broadcastTxid || txConfirmations !== null) {
      return
    }

    const id = setInterval(() => {
      fetchTxConfirmations(broadcastTxid)
        .then(confirmations => {
          if (confirmations !== null && confirmations >= 1) {
            setTxConfirmations(confirmations)
            clearInterval(id)
          }
        })
        .catch(console.warn)
    }, 15_000)

    return () => clearInterval(id)
  }, [broadcastTxid, txConfirmations])

  const explorerUrl = broadcastTxid ? getTxExplorerUrl(broadcastTxid) : null

  const handleSignAndBroadcast = async () => {
    if (!pset) {
      return
    }

    setBroadcasting(true)
    setBroadcastError(null)
    setBroadcastTxid(null)

    try {
      const txid = await signAndBroadcast(pset)
      setBroadcastTxid(txid)
      setTxConfirmations(null)
    } catch (err) {
      setBroadcastError(err instanceof Error ? err.message : String(err))
    } finally {
      setBroadcasting(false)
    }
  }

  const handleSpendCovenant = async () => {
    if (!result) {
      return
    }

    setBroadcasting(true)
    setBroadcastError(null)
    setBroadcastTxid(null)

    try {
      const [covenantUtxo] = await fetchAddressUtxo(result.address)

      if (!covenantUtxo?.value || !covenantUtxo.asset) {
        throw new Error('Missing explicit covenant L-BTC UTXO')
      }

      const policyAsset = lwkNetwork.policyAsset()

      if (covenantUtxo.asset !== policyAsset.toString()) {
        throw new Error('Covenant UTXO asset is not L-BTC')
      }

      const walletUtxo = (await getWalletUtxos()).find(
        utxo => utxo.unblinded().asset().toString() === policyAsset.toString(),
      )

      if (!walletUtxo) {
        throw new Error('Missing wallet L-BTC UTXO for fees')
      }

      const previousTx = Transaction.fromBytes(await fetchTxRaw(covenantUtxo.txid))
      const externalUtxo = new ExternalUtxo(
        covenantUtxo.vout,
        previousTx,
        TxOutSecrets.fromExplicit(policyAsset, BigInt(covenantUtxo.value)),
        2_000,
        true,
      )
      const spendPset = buildExternalExplicitRecipientPset({
        wollet: getWollet(),
        network: lwkNetwork,
        recipientAddress: result.receiveAddress,
        outpoints: [walletUtxo.outpoint()],
        externalUtxos: [externalUtxo],
        satoshi: BigInt(covenantUtxo.value),
        feeRate: 100,
      })

      setPset(spendPset)
      setPsetString(spendPset.toString())
    } catch (err) {
      setBroadcastError(err instanceof Error ? err.message : String(err))
    } finally {
      setBroadcasting(false)
    }
  }

  return (
    <div className='space-y-4'>
      <div className='rounded border border-gray-300 bg-white p-4'>
        <div className='font-bold'>ScriptAuth Covenant Smoke Test</div>

        <div className='mt-4 flex flex-wrap gap-2'>
          <button
            className='rounded bg-accent-soft-hover px-4 py-2 text-sm disabled:opacity-50'
            disabled={!pset || broadcasting || connectionStatus !== 'ready'}
            onClick={handleSignAndBroadcast}
          >
            {broadcasting ? 'Confirm on device…' : 'Sign & Broadcast PSET'}
          </button>

          <button
            className='rounded border border-gray-300 px-4 py-2 text-sm disabled:opacity-50'
            disabled={!result || broadcasting || connectionStatus !== 'ready'}
            onClick={handleSpendCovenant}
          >
            Spend Covenant UTXO
          </button>
        </div>

        {broadcastError && <p className='mt-2 text-xs text-red-500'>{broadcastError}</p>}

        <pre className='mt-4 rounded bg-gray-100 p-4 text-sm overflow-x-auto'>
          {JSON.stringify(
            {
              pset: psetString,
              hasPubkey: !!xOnlyPublicKey,
              error,
              broadcastError,
              result,
            },
            null,
            2,
          )}
        </pre>
        {broadcastTxid && (
          <div className='mt-4 rounded border border-green-500 bg-green-50 p-4'>
            <div className='font-bold'>Broadcasted</div>

            <div className='mt-2 break-all'>TXID: {broadcastTxid}</div>

            <a
              href={explorerUrl ?? '#'}
              target='_blank'
              rel='noopener noreferrer'
              className='mt-2 block text-blue-600 underline'
            >
              Open in Explorer
            </a>
            <p className='mt-2 text-xs text-gray-500'>
              {txConfirmations !== null
                ? `${txConfirmations} confirmation${txConfirmations === 1 ? '' : 's'}`
                : 'Waiting for confirmation...'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
