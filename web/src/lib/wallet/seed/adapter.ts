/**
 * A wallet whose key is a recovery phrase this page holds, as one adapter behind the facade.
 *
 * Demo only, and gated on the build saying so: a phrase in a browser tab is the whole account,
 * and `VITE_DEMO_MODE` is what a build says to admit one. It is here because it is the one wallet
 * a test can drive — a device needs a button pressed and a remote wallet needs an approval — so
 * what the other signing wallets do is proven first here.
 *
 * Everything below the key is shared: the chain session builds and syncs the wallet object, and
 * the protocol dispatch performs an action by calling the same builder a product screen calls.
 * What this file adds is the connector, and the wiring between them.
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
  WalletActionRequest,
  WalletAdapter,
  WalletCapabilities,
  WalletConnectionState,
  WalletConnectOptions,
  WalletUtxo,
} from '@/lib/wallet/types'
import { useWolletSession } from '@/lib/wallet/wolletSession'
import { SeedConnector } from '@/lib/wallet-core/connector/seed'
import { DEFAULT_WALLET_TYPE } from '@/lib/wallet-core/types'
import { isConfirmedWalletUtxo, utxoToOutpointString } from '@/lwk/utxo'
import { useOptionalLwk } from '@/providers/lwk/useLwk'

const SEED_ID = 'seed'
const NOT_A_DEMO_BUILD = 'This build carries no demo wallet.'
const NO_PHRASE = 'This wallet needs a recovery phrase to start.'
const CHAIN_LIBRARY_MISSING = 'The chain library is not loaded on this page.'

/** Only where a build says so. A recovery phrase in a page is the account, not a convenience. */
const unavailableReason = env.VITE_DEMO_MODE ? null : NOT_A_DEMO_BUILD

export function useSeedWallet(): WalletAdapter {
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

  // The signer is a WebAssembly object holding a key. It is never put in React state, which would
  // copy a pointer into a render, and never survives a disconnect.
  const connectorRef = useRef<SeedConnector | null>(null)
  const [state, setState] = useState<WalletConnectionState>(
    unavailableReason ? 'unavailable' : 'disconnected',
  )
  const [descriptor, setDescriptor] = useState<string | null>(null)
  const [account, setAccount] = useState<string | null>(null)

  const connect = useCallback(
    async (options?: WalletConnectOptions) => {
      if (unavailableReason) throw new WalletUnavailableError(unavailableReason)
      if (!lwk) throw new WalletUnavailableError(CHAIN_LIBRARY_MISSING)

      const mnemonic = options?.mnemonic ?? env.VITE_DEBUG_MNEMONIC

      if (!mnemonic) throw new WalletUnavailableError(NO_PHRASE)

      setState('connecting')
      try {
        const connector = new SeedConnector(lwk.lwkNetwork, mnemonic)

        await connector.connect()
        connectorRef.current = connector

        const request = await connector.getDescriptor(DEFAULT_WALLET_TYPE)
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
        // What this dapp calls the account: the address it receives at, which is what a person
        // can check against what their own wallet shows. The wallet's own script is derived from
        // the descriptor, not from this.
        setAccount(receivesAt)
        setState('connected')
      } catch (error) {
        await connectorRef.current?.disconnect().catch(() => {})
        connectorRef.current = null
        setState('disconnected')
        throw error
      }
    },
    [lwk, openSession],
  )

  const disconnect = useCallback(
    async (options?: { cachePolicy?: CachePolicy }) => {
      const connector = connectorRef.current

      connectorRef.current = null
      setState(unavailableReason ? 'unavailable' : 'disconnected')
      setDescriptor(null)
      setAccount(null)
      await closeSession(options)
      // The signer holds the key: it is dropped last, and its failure does not leave the page
      // believing it is still connected.
      await connector?.disconnect().catch(console.warn)
    },
    [closeSession],
  )

  const capabilities = useMemo<WalletCapabilities>(() => {
    const requireDescriptor = () => {
      if (!descriptor) throw new WalletNotConnectedError('reading the account descriptor')

      return descriptor
    }

    const signPset = async (pset: Pset): Promise<Pset> => {
      const connector = connectorRef.current

      if (!connector) throw new WalletNotConnectedError('signing a transaction')

      // The asset registry's contract data goes in first, so what is signed carries asset names
      // rather than hashes. A device shows them; a software signer does not, and embedding them
      // anyway keeps one signing path rather than two.
      const request = await connector.signPset(await addAssetContracts(pset))

      return request.result
    }

    return {
      ...chain,
      getWalletDescriptor: async () => requireDescriptor(),
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
            const unblinded = utxo.unblinded()
            const [txid, vout] = utxoToOutpointString(utxo).split(':')

            return {
              txid: txid!,
              vout: Number(vout),
              assetId,
              amount: unblinded.value().toString(),
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
      id: SEED_ID,
      signerType: 'seed',
      name: 'Seed phrase',
      isAvailable: unavailableReason === null,
      unavailableReason,
      // A build carrying a phrase of its own starts without asking; otherwise the person's is the
      // only one there is.
      requiresRecoveryPhrase: !env.VITE_DEBUG_MNEMONIC,
      state,
      account: account === null ? null : { address: account, chainId: SIGNING_CHAIN_ID },
      // Nothing is remembered between page loads: the phrase is the account, and a phrase kept in
      // a browser store is one anything on the page can read.
      restoring: false,
      // What the facade watches to know this wallet's answers have moved without being asked.
      chainUpdates,
      connect,
      disconnect,
      openAccount: () => {},
      capabilities,
    }),
    [account, capabilities, chainUpdates, connect, disconnect, state],
  )
}
