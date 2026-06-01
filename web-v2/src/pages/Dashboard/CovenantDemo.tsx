import {
  Address,
  ExternalUtxo,
  type Network,
  type Pset,
  SimplicityLogLevel,
  Transaction,
  TxBuilder,
  TxOutSecrets,
  type WalletTxOut,
  type XOnlyPublicKey,
} from 'lwk_web'
import { useEffect, useState } from 'react'
import { sources } from 'virtual:simplicity-sources'

import {
  broadcastTx,
  fetchAddressUtxo,
  fetchTxConfirmations,
  fetchTxRaw,
} from '@/api/esplora/methods'
import { getTxExplorerUrl } from '@/api/esplora/utils'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import { buildScriptAuthWitness, loadScriptAuthProgram } from '@/simplicity/covenants/scriptAuth'
import { hexToBytes } from '@/utils/hex'

interface CovenantResult {
  sourceLoaded: boolean
  xOnlyPublicKey: string
  receiveAddress: string
  scriptHash: number[]
  scriptHashHex: string
  authOutpoint: string
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
  scriptHash: string
  selectedRole?: 'funding' | 'auth'
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
    scriptHash: utxo.scriptPubkey().jet_sha256_hex(),
    wildcardIndex: utxo.wildcardIndex(),
  }
}

function outpointString(utxo: WalletTxOut): string {
  const outpoint = utxo.outpoint()
  return `${outpoint.txid().toString()}:${outpoint.vout()}`
}

async function findExistingCovenant(
  authUtxos: WalletTxOut[],
  key: XOnlyPublicKey,
  network: Network,
) {
  for (const authUtxo of authUtxos) {
    const scriptHashHex = authUtxo.scriptPubkey().jet_sha256_hex()
    const scriptHash = hexToBytes(scriptHashHex)
    const scriptAuthProgram = loadScriptAuthProgram(scriptHash)
    const covenantAddress = scriptAuthProgram.createP2trAddress(key, network)
    const covenantUtxos = await fetchAddressUtxo(covenantAddress.toString())

    if (covenantUtxos.length > 0) {
      return {
        authUtxo,
        scriptHashHex,
        scriptHash,
        scriptAuthProgram,
        covenantAddress,
        covenantUtxos,
      }
    }
  }

  return null
}

export default function CovenantDemo() {
  const { lwkNetwork } = useLwk()

  const {
    connectionStatus,
    getXOnlyPublicKey,
    getReceiveAddress,
    getWalletUtxos,
    getWollet,
    signPset,
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

        const xOnlyPublicKey = await getXOnlyPublicKey()

        if (!xOnlyPublicKey) {
          throw new Error('Missing x-only public key')
        }

        const receiveAddress = await getReceiveAddress()

        if (!receiveAddress) {
          throw new Error('Missing receive address')
        }

        const walletUtxos = await getWalletUtxos()
        const policyAsset = lwkNetwork.policyAsset().toString()
        const lbtcUtxos = walletUtxos.filter(
          utxo => utxo.unblinded().asset().toString() === policyAsset,
        )

        if (lbtcUtxos.length < 1) {
          throw new Error('Need at least one wallet L-BTC UTXO to use as the covenant auth input')
        }

        const feeReserve = 10_000n
        const existing = await findExistingCovenant(lbtcUtxos, xOnlyPublicKey, lwkNetwork)
        console.log('existing', existing)
        const authUtxo = existing?.authUtxo ?? lbtcUtxos[1] ?? lbtcUtxos[0]
        const authOutpoint = outpointString(authUtxo)
        const fundingUtxo = lbtcUtxos.find(
          utxo => outpointString(utxo) !== authOutpoint && utxo.unblinded().value() > feeReserve,
        )
        const fundingOutpoint = fundingUtxo ? outpointString(fundingUtxo) : null
        const scriptHashHex = existing?.scriptHashHex ?? authUtxo.scriptPubkey().jet_sha256_hex()
        const scriptHash = existing?.scriptHash ?? hexToBytes(scriptHashHex)
        const scriptAuthProgram = existing?.scriptAuthProgram ?? loadScriptAuthProgram(scriptHash)

        console.info('covenant demo wallet UTXO selection', {
          policyAsset,
          lbtcUtxoCount: lbtcUtxos.length,
          existingCovenantFound: !!existing,
          funding: fundingUtxo
            ? {
                outpoint: fundingOutpoint,
                value: fundingUtxo.unblinded().value().toString(),
                address: fundingUtxo.address().toString(),
                scriptHash: fundingUtxo.scriptPubkey().jet_sha256_hex(),
              }
            : null,
          auth: {
            outpoint: authOutpoint,
            value: authUtxo.unblinded().value().toString(),
            address: authUtxo.address().toString(),
            scriptHash: scriptHashHex,
          },
          allLbtcUtxos: lbtcUtxos.map(utxo => ({
            outpoint: outpointString(utxo),
            value: utxo.unblinded().value().toString(),
            address: utxo.address().toString(),
            scriptHash: utxo.scriptPubkey().jet_sha256_hex(),
            wildcardIndex: utxo.wildcardIndex(),
          })),
        })

        const covenantAddress =
          existing?.covenantAddress ??
          scriptAuthProgram.createP2trAddress(xOnlyPublicKey, lwkNetwork)
        const covenantUtxos =
          existing?.covenantUtxos ?? (await fetchAddressUtxo(covenantAddress.toString()))
        const feeRate = 100

        const builtPset = fundingUtxo
          ? new TxBuilder(lwkNetwork)
              .feeRate(feeRate)
              .setWalletUtxos([fundingUtxo.outpoint()])
              .addExplicitRecipient(
                covenantAddress,
                fundingUtxo.unblinded().value() - feeReserve,
                lwkNetwork.policyAsset(),
              )
              .finish(getWollet())
          : null
        const psetString = builtPset?.toString() ?? null
        const txOutputs =
          builtPset?.extractTx().outputs.map(
            (output): TxOutputSummary => ({
              asset: output?.asset()?.toString(),
              amount: output.value()?.toString(),
              script: output.scriptPubkey().toString(),
            }),
          ) ?? []

        if (cancelled) {
          return
        }

        setXOnlyPublicKey(xOnlyPublicKey)
        setPset(builtPset)
        setPsetString(psetString)

        setResult({
          sourceLoaded: !!sources.script_auth,

          xOnlyPublicKey: xOnlyPublicKey.toString(),

          receiveAddress,

          scriptHash: Array.from(scriptHash),
          scriptHashHex,
          authOutpoint,

          address: covenantAddress.toString(),

          cmr: scriptAuthProgram.cmr.toString(),

          txOutputs,

          utxos: {
            covenant: covenantUtxos,
            wallet: walletUtxos.map(utxo => {
              const summary = summarizeWalletUtxo(utxo)
              if (summary.outpoint === fundingOutpoint) {
                return { ...summary, selectedRole: 'funding' }
              }
              if (summary.outpoint === authOutpoint) {
                return { ...summary, selectedRole: 'auth' }
              }
              return summary
            }),
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
    if (!result || !xOnlyPublicKey) {
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

      const expectedScriptHash = result.scriptHashHex
      const walletUtxo = (await getWalletUtxos()).find(
        utxo =>
          utxo.unblinded().asset().toString() === policyAsset.toString() &&
          utxo.scriptPubkey().jet_sha256_hex() === expectedScriptHash,
      )

      if (!walletUtxo) {
        throw new Error(`Missing wallet L-BTC auth UTXO with script hash ${expectedScriptHash}`)
      }

      const covenantTx = Transaction.fromBytes(await fetchTxRaw(covenantUtxo.txid))
      const covenantTxOut = covenantTx.outputs[covenantUtxo.vout]

      if (!covenantTxOut) {
        throw new Error('Covenant funding transaction does not have the UTXO output')
      }

      const walletOutpoint = walletUtxo.outpoint()
      const walletOutpointLog = `${walletOutpoint.txid().toString()}:${walletOutpoint.vout()}`
      const walletUtxoScriptHash = walletUtxo.scriptPubkey().jet_sha256_hex()
      const walletTx = Transaction.fromBytes(await fetchTxRaw(walletOutpoint.txid().toString()))
      const walletTxOut = walletTx.outputs[walletOutpoint.vout()]

      if (!walletTxOut) {
        throw new Error('Wallet funding transaction does not have the selected output')
      }

      const walletTxOutScriptHash = walletTxOut.scriptPubkey().jet_sha256_hex()
      const covenantOutpointLog = `${covenantUtxo.txid}:${covenantUtxo.vout}`
      const covenantExternalUtxo = new ExternalUtxo(
        covenantUtxo.vout,
        covenantTx,
        TxOutSecrets.fromExplicit(policyAsset, BigInt(covenantUtxo.value)),
        20_000,
        true,
      )

      const recipientAddress = Address.parse(result.receiveAddress, lwkNetwork)
        .toUnconfidential()
        .toString()

      const spendPset = new TxBuilder(lwkNetwork)
        .feeRate(100)
        .setWalletUtxos([walletOutpoint])
        .addExternalUtxos([covenantExternalUtxo])
        .addExplicitRecipient(
          new Address(recipientAddress),
          BigInt(covenantUtxo.value),
          lwkNetwork.policyAsset(),
        )
        .finish(getWollet())

      setPsetString(spendPset.toString())

      console.info('script_auth spend step: signing wallet input')
      const signedSpendPset = await signPset(spendPset)
      console.info('script_auth spend step: finalizing wallet pset')
      const finalizedWalletPset = getWollet().finalize(signedSpendPset)
      console.info('script_auth spend step: extracting tx')
      const txWithWalletWitness = finalizedWalletPset.extractTx()
      console.info('script_auth spend step: loading script_auth program', {
        scriptHashHex: result.scriptHashHex,
        scriptHashLength: result.scriptHash.length,
        sourceLoaded: result.sourceLoaded,
      })
      let scriptAuthProgram: ReturnType<typeof loadScriptAuthProgram>
      try {
        scriptAuthProgram = loadScriptAuthProgram(hexToBytes(result.scriptHashHex))
      } catch (err) {
        console.error('script_auth spend failed while loading program', err)
        throw err
      }
      console.info('script_auth spend debug', {
        expectedScriptHash,
        expectedAuthOutpoint: result.authOutpoint,
        walletUtxoScriptHash,
        walletTxOutScriptHash,
        walletOutpoint: walletOutpointLog,
        covenantOutpoint: covenantOutpointLog,
        inputScriptIndexWitness: 1,
      })
      console.info('script_auth spend step: finalizing simplicity input')
      const finalizedTx = scriptAuthProgram.finalizeTransaction(
        txWithWalletWitness,
        xOnlyPublicKey,
        [covenantTxOut, walletTxOut],
        0,
        buildScriptAuthWitness(1),
        lwkNetwork,
        SimplicityLogLevel.Trace,
      )
      console.info('script_auth spend step: broadcasting finalized tx')
      const txid = await broadcastTx(finalizedTx.toString())

      setPset(null)
      setBroadcastTxid(txid)
      setTxConfirmations(null)
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
