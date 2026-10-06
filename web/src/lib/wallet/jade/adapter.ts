/**
 * A Jade device, as one adapter behind the facade.
 *
 * The key never leaves the device and every signature is a button press on it, so two things this
 * file does are not shared with the software wallets. It reports `locked`, which is a device
 * waiting for a PIN rather than a wallet that is not connected — the screens branch on it and the
 * unlock modal is the branch. And it watches the port: a device unplugged mid-session is a session
 * that has ended, whatever this page still believes.
 *
 * Everything below the key is shared. The chain session builds and syncs the wallet object and
 * puts the asset registry's contract data into every transaction before it is signed, which is
 * what makes the device show asset names rather than hashes.
 */

import type { Pset } from '@lilbonekit/lwk-web'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { WalletNotConnectedError, WalletUnavailableError } from '@/lib/wallet/errors'
import { withoutBlindingKey } from '@/lib/wallet/lwk'
import { SIGNING_CHAIN_ID } from '@/lib/wallet/network'
import { performProtocolActionLocally } from '@/lib/wallet/protocolActions'
import type {
  CachePolicy,
  WalletActionRequest,
  WalletAdapter,
  WalletCapabilities,
  WalletConnectionState,
  WalletConnectOptions,
  WalletUtxo,
} from '@/lib/wallet/types'
import { useWolletSession } from '@/lib/wallet/wolletSession'
import { JadeBusyError, JadeDisconnectedError } from '@/lib/wallet-core/connector/errors'
import { JadeConnector } from '@/lib/wallet-core/connector/jade'
import { DEFAULT_WALLET_TYPE, type WalletType } from '@/lib/wallet-core/types'
import { isConfirmedWalletUtxo, utxoToOutpointString } from '@/lwk/utxo'
import { useOptionalLwk } from '@/providers/lwk/useLwk'

const JADE_ID = 'jade'
const NO_SERIAL = 'This browser cannot talk to a Jade device.'
const CHAIN_LIBRARY_MISSING = 'The chain library is not loaded on this page.'

/** How often a connected device is asked whether it is still there and still unlocked. */
const DEVICE_POLL_INTERVAL_MS = 3_000

/** Web Serial is how a Jade is reached at all, and not every browser has it. */
const unavailableReason = 'serial' in navigator ? null : NO_SERIAL

export function useJadeWallet(): WalletAdapter {
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

  // The device holds the key and the port. Neither goes into React state.
  const connectorRef = useRef<JadeConnector | null>(null)
  const [state, setState] = useState<WalletConnectionState>(
    unavailableReason ? 'unavailable' : 'disconnected',
  )
  const [variant, setVariant] = useState<WalletType>(DEFAULT_WALLET_TYPE)
  const [descriptor, setDescriptor] = useState<string | null>(null)
  const [account, setAccount] = useState<string | null>(null)
  const [usbDeviceDetected, setUsbDeviceDetected] = useState(false)

  const endSession = useCallback(
    async (options?: { cachePolicy?: CachePolicy }) => {
      const connector = connectorRef.current

      connectorRef.current = null
      setState(unavailableReason ? 'unavailable' : 'disconnected')
      setDescriptor(null)
      setAccount(null)
      // The port's listeners come off with the session, so nothing is left to notice an unplug
      // afterwards. A flag left true says a device is there to a modal that branches on it.
      setUsbDeviceDetected(false)
      await closeSession(options)
      // Not awaited before the page is told: a device that was unplugged can leave this hanging,
      // and a session that has ended has ended whether or not its port closes politely.
      connector?.disconnect().catch(console.warn)
    },
    [closeSession],
  )

  const connect = useCallback(
    async (options?: WalletConnectOptions) => {
      if (unavailableReason) throw new WalletUnavailableError(unavailableReason)
      if (!lwk) throw new WalletUnavailableError(CHAIN_LIBRARY_MISSING)

      const chosen = (options?.variant ?? DEFAULT_WALLET_TYPE) as WalletType

      setVariant(chosen)
      setState('connecting')
      try {
        const connector = new JadeConnector(lwk.lwkNetwork)

        await connector.connect()
        connectorRef.current = connector
        // A device that was already paired and replugged fires the port's own connect event; one
        // picked from the browser's chooser never does, so this is where it is known.
        setUsbDeviceDetected(true)

        // Asked before the descriptor, because asking for the descriptor blocks on the PIN and
        // the screens have to be able to say what is being waited for.
        if ((await connector.getConnectionStatus()) === 'locked') setState('locked')

        const request = await connector.getDescriptor(chosen)
        const wolletDescriptor = await request.result

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
   * The device is asked, on a timer, whether it is still there and still unlocked. A PIN can lock
   * again while the tab is open and a cable can be pulled, and neither tells this page anything.
   */
  useEffect(() => {
    if (state !== 'connected' && state !== 'locked') return

    const timer = setInterval(() => {
      const connector = connectorRef.current

      if (!connector) return

      connector
        .getConnectionStatus()
        .then(status => {
          // Locking again is a session that has to start over: the PIN flow runs at connect, and
          // there is no half-connected state for it to resume into.
          if (status === 'locked' && state === 'connected') {
            endSession().catch(console.warn)
          }
        })
        .catch((error: unknown) => {
          // A signature in progress owns the port; the poll is skipped rather than read as a
          // device that has gone away.
          if (error instanceof JadeBusyError) return

          console.warn(new JadeDisconnectedError())
          endSession().catch(console.warn)
        })
    }, DEVICE_POLL_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [endSession, state])

  /*
   * The port's own events, listened to only while this wallet is in use. An adapter is built on
   * every render whether or not anyone picked it, and one nobody picked has no business holding
   * listeners on the browser's serial port.
   */
  useEffect(() => {
    if (state === 'disconnected' || state === 'unavailable') return
    if (!('serial' in navigator)) return

    const onConnect = () => setUsbDeviceDetected(true)
    const onDisconnect = () => {
      setUsbDeviceDetected(false)
      endSession().catch(console.warn)
    }

    navigator.serial.addEventListener('connect', onConnect)
    navigator.serial.addEventListener('disconnect', onDisconnect)

    return () => {
      navigator.serial.removeEventListener('connect', onConnect)
      navigator.serial.removeEventListener('disconnect', onDisconnect)
    }
  }, [endSession, state])

  const capabilities = useMemo<WalletCapabilities>(() => {
    const signPset = async (pset: Pset): Promise<Pset> => {
      const connector = connectorRef.current

      if (!connector) throw new WalletNotConnectedError('signing a transaction')

      // The registry's contract data goes in before the device sees it. Without it the device
      // still signs, and shows an asset hash where it could have shown a name — which is the kind
      // of difference nobody notices until someone approves the wrong thing.
      const request = await connector.signPset(await addAssetContracts(pset))

      return request.result
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
      id: JADE_ID,
      signerType: 'jade',
      name: 'Jade',
      isAvailable: unavailableReason === null,
      unavailableReason,
      state,
      account: account === null ? null : { address: account, chainId: SIGNING_CHAIN_ID },
      // A device is not a session this origin holds: it is reconnected by being asked for again.
      restoring: false,
      // What the facade watches to know this wallet's answers have moved without being asked.
      chainUpdates,
      usbDeviceDetected,
      variant,
      connect,
      disconnect: endSession,
      openAccount: () => {},
      capabilities,
    }),
    [account, capabilities, chainUpdates, connect, endSession, state, usbDeviceDetected, variant],
  )
}
