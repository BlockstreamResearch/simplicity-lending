/**
 * A SideSwap wallet, reached through SideSwap's Liquid Connect relay, as one adapter.
 *
 * Nothing here holds a key and nothing here can hurry: a person approves a login and every
 * signature in another application, and until they do this wallet is waiting. That waiting is the
 * whole difference from the other adapters. It is published as a pending request, with the link
 * that opens the wallet and the means to give up on it, so a screen can say what is being waited
 * for rather than showing a spinner that never ends.
 *
 * Experimental, and the connector says why: the relay hands over a descriptor as an
 * accommodation, which its steady-state design means to replace with UTXO snapshots.
 */

import type { Pset } from '@lilbonekit/lwk-web'
import { useCallback, useMemo, useRef, useState } from 'react'

import { env } from '@/constants/env'
import { WalletNotConnectedError, WalletUnavailableError } from '@/lib/wallet/errors'
import { withoutBlindingKey } from '@/lib/wallet/lwk'
import { SIGNING_CHAIN_ID } from '@/lib/wallet/network'
import { performProtocolActionLocally } from '@/lib/wallet/protocolActions'
import type {
  CachePolicy,
  PendingWalletRequest,
  WalletActionRequest,
  WalletAdapter,
  WalletCapabilities,
  WalletConnectionState,
  WalletConnectOptions,
  WalletUtxo,
} from '@/lib/wallet/types'
import { useWolletSession } from '@/lib/wallet/wolletSession'
import { SideSwapConnector } from '@/lib/wallet-core/connector/sideswap'
import { isConfirmedWalletUtxo, utxoToOutpointString } from '@/lwk/utxo'
import { useOptionalLwk } from '@/providers/lwk/useLwk'

const SIDESWAP_ID = 'sideswap'
const NO_RELAY = 'This build has no SideSwap relay to reach a wallet through.'
const CHAIN_LIBRARY_MISSING = 'The chain library is not loaded on this page.'

/** The relay is how a SideSwap wallet is reached at all, and a build may carry none. */
const relayUrl = env.VITE_SIDESWAP_WS_URL ?? ''
const unavailableReason = relayUrl ? null : NO_RELAY

export function useSideSwapWallet(): WalletAdapter {
  const lwk = useOptionalLwk()
  const session = useWolletSession()
  // Only the parts that do not change as the chain does. Depending on the session itself would
  // rebuild everything below on every rescan, and the facade would derive the account's script
  // again each time — once a minute, for an account that has not moved.
  const {
    capabilities: chain,
    addAssetContracts,
    readBalances,
    pendingBroadcastTxids,
    chainUpdates,
    open: openSession,
    close: closeSession,
  } = session

  const connectorRef = useRef<SideSwapConnector | null>(null)
  // How to give up on whatever the person is being waited for, when there is something to give up.
  const cancelRef = useRef<(() => Promise<void>) | null>(null)
  const [state, setState] = useState<WalletConnectionState>(
    unavailableReason ? 'unavailable' : 'disconnected',
  )
  const [descriptor, setDescriptor] = useState<string | null>(null)
  const [account, setAccount] = useState<string | null>(null)
  const [pendingRequest, setPendingRequest] = useState<PendingWalletRequest | null>(null)

  const endSession = useCallback(
    async (options?: { cachePolicy?: CachePolicy }) => {
      const connector = connectorRef.current

      connectorRef.current = null
      cancelRef.current = null
      setPendingRequest(null)
      setState(unavailableReason ? 'unavailable' : 'disconnected')
      setDescriptor(null)
      setAccount(null)
      await closeSession(options)
      await connector?.disconnect().catch(console.warn)
    },
    [closeSession],
  )

  const connect = useCallback(
    async (options?: WalletConnectOptions) => {
      if (unavailableReason) throw new WalletUnavailableError(unavailableReason)
      if (!lwk) throw new WalletUnavailableError(CHAIN_LIBRARY_MISSING)

      setState('connecting')
      try {
        const connector = new SideSwapConnector(relayUrl)

        await connector.connect()
        connectorRef.current = connector

        // Reattaching to a session the relay still holds, rather than starting a login nobody is
        // looking at: a page that reloads itself must not put a request in front of a person who
        // did not ask for one.
        if (options?.resumeOnly && (await connector.getConnectionStatus()) !== 'ready') {
          await endSession()

          return
        }

        // The relay hands back whatever the remote wallet holds; there is no variant to ask for.
        const request = await connector.getDescriptor()

        if (request.id) {
          cancelRef.current = request.cancel ?? null
          setPendingRequest({
            kind: 'login',
            requestId: request.id,
            appLink: request.appLink ?? null,
          })
        }

        const wolletDescriptor = await request.result

        cancelRef.current = null
        setPendingRequest(null)

        // The address comes back from opening rather than being asked for afterwards: what this
        // callback holds of the session was captured before the session opened, and would answer
        // null forever — a wallet that reports itself connected with no account, which is the one
        // thing the facade keys every read on.
        const receivesAt = await openSession(wolletDescriptor)

        // Published without the account's blinding key. The wollet below keeps the real
        // descriptor, because unblinding this account's own outputs is its whole job; what is
        // handed out above the facade can only derive a script.
        setDescriptor(withoutBlindingKey(wolletDescriptor.toString()))
        setAccount(receivesAt)
        setState('connected')
      } catch (error) {
        await endSession()
        throw error
      }
    },
    [endSession, lwk, openSession],
  )

  /*
   * Give up on what the person is being waited for.
   *
   * The session ends first and the relay is told after: whatever the relay answers, this page has
   * stopped waiting, and a cancel that hangs must not leave a screen waiting on a request nobody
   * intends to approve.
   */
  const cancelPendingRequest = useCallback(async () => {
    const cancel = cancelRef.current

    cancelRef.current = null
    await endSession()
    await cancel?.().catch(console.warn)
  }, [endSession])

  const capabilities = useMemo<WalletCapabilities>(() => {
    const signPset = async (pset: Pset): Promise<Pset> => {
      const connector = connectorRef.current

      if (!connector) throw new WalletNotConnectedError('signing a transaction')

      const request = await connector.signPset(await addAssetContracts(pset))

      if (request.id) {
        cancelRef.current = request.cancel ?? null
        setPendingRequest({
          kind: 'sign',
          requestId: request.id,
          appLink: request.appLink ?? null,
        })
      }

      try {
        return await request.result
      } finally {
        cancelRef.current = null
        setPendingRequest(null)
      }
    }

    return {
      ...chain,
      getWalletDescriptor: async () => {
        if (!descriptor) throw new WalletNotConnectedError('reading the account descriptor')

        return descriptor
      },
      // The scan knows what has confirmed and what has not, and the difference decides whether an
      // action can be funded: input selection spends confirmed outputs only, so a screen told the
      // whole balance is spendable enables a button that then refuses.
      getBalance: async (assetId: string) => {
        const held = readBalances()

        return {
          total: held.total[assetId] ?? '0',
          confirmed: held.confirmed[assetId] ?? '0',
          pending: held.pending[assetId] ?? '0',
        }
      },
      getUtxos: async (assetId: string): Promise<WalletUtxo[]> => {
        const utxos = await chain.getBlindedWalletUtxos()

        return utxos
          .filter(utxo => utxo.unblinded().asset().toString() === assetId)
          .map(utxo => {
            const [txid, vout] = utxoToOutpointString(utxo).split(':')

            return {
              txid: txid!,
              vout: Number(vout),
              assetId,
              amount: utxo.unblinded().value().toString(),
              address: utxo.address().toString(),
              scriptPubkey: utxo.scriptPubkey().toString(),
              confidential: true,
              spendable: isConfirmedWalletUtxo(utxo),
            }
          })
      },
      signPset,
      performAction: (request: WalletActionRequest) => {
        if (!lwk) return Promise.reject(new WalletUnavailableError(CHAIN_LIBRARY_MISSING))

        return performProtocolActionLocally(
          {
            lwkNetwork: lwk.lwkNetwork,
            // What this wallet has already sent and not seen confirmed, so the fee beats it.
            processingTxids: pendingBroadcastTxids(),
            getWollet: chain.getWollet,
            getBlindedWalletUtxos: chain.getBlindedWalletUtxos,
            getReceiveAddress: chain.getReceiveAddress,
            syncWallet: chain.rescan,
            signPset,
            applyBroadcastTransaction: chain.applyBroadcastTransaction,
          },
          request as never,
        )
      },
    }
  }, [addAssetContracts, chain, descriptor, lwk, pendingBroadcastTxids, readBalances])

  return useMemo(
    () => ({
      id: SIDESWAP_ID,
      signerType: 'sideswap',
      name: 'SideSwap',
      isAvailable: unavailableReason === null,
      unavailableReason,
      state,
      account: account === null ? null : { address: account, chainId: SIGNING_CHAIN_ID },
      restoring: false,
      // What the facade watches to know this wallet's answers have moved without being asked.
      chainUpdates,
      pendingRequest,
      cancelPendingRequest,
      connect,
      disconnect: endSession,
      openAccount: () => {},
      capabilities,
    }),
    [
      account,
      cancelPendingRequest,
      capabilities,
      chainUpdates,
      connect,
      endSession,
      pendingRequest,
      state,
    ],
  )
}
