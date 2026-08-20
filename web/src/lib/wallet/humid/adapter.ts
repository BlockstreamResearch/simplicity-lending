import { useAppKitAccount, useAppKitProvider } from '@reown/appkit/react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { appKit } from '@/lib/humid/appkit'
import {
  type CaipRpcProvider,
  createWalletClient,
  HUMID_CONNECTOR,
} from '@/lib/humid/appkit-injected-adapter'
import {
  WalletCapabilityUnavailableError,
  WalletConnectionRefusedError,
  WalletNotConnectedError,
  WalletUnavailableError,
} from '@/lib/wallet/errors'
import { walletAssetId } from '@/lib/wallet/humid/assetId'
import {
  WALLET_CHAIN_ID,
  WALLET_CHAIN_UNSUPPORTED_REASON,
  WALLET_NAMESPACE,
} from '@/lib/wallet/network'
import type {
  WalletActionRequest,
  WalletActionResult,
  WalletAdapter,
  WalletCapabilities,
  WalletUtxo,
} from '@/lib/wallet/types'

/**
 * The extension injects its provider from a content script, so it is absent for the first tick
 * of a fresh load. Three seconds of looking tells "not installed" apart from "not injected yet"
 * without leaving the connect option greyed out on a slow load.
 */
const PRESENCE_POLL_INTERVAL_MS = 250
const PRESENCE_POLL_ATTEMPTS = 12

const NOT_INSTALLED = 'The HUMID extension is not on this page.'

/** Whether the extension has put its provider on the page yet. */
function useInjectedPresence(): boolean {
  const [present, setPresent] = useState(() => window.humid !== undefined)

  useEffect(() => {
    if (present) return

    let attempts = 0
    const timer = setInterval(() => {
      attempts += 1

      if (window.humid !== undefined) {
        setPresent(true)
        clearInterval(timer)
      } else if (attempts >= PRESENCE_POLL_ATTEMPTS) {
        clearInterval(timer)
      }
    }, PRESENCE_POLL_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [present])

  return present
}

/** Everything the wallet does as the connected account, or a refusal that says which and why. */
function useCapabilities(provider: CaipRpcProvider | undefined): WalletCapabilities {
  return useMemo(() => {
    const client =
      provider && WALLET_CHAIN_ID ? createWalletClient(provider, WALLET_CHAIN_ID) : null

    return {
      async getWalletDescriptor() {
        if (!client) throw new WalletNotConnectedError('reading the account descriptor')

        // The wallet serves two formats and both are non-confidential; the confidential ones its
        // developer page offers are refused. So this asks for what exists and takes the entry
        // that can derive scripts, which is what every read here identifies an account by.
        const { descriptors } = await client.getWalletDescriptor({
          descriptorFormat: [{ format: 'bip380-bip389-multipath' }],
          descriptorType: 'publicWalletDescriptor',
        })

        const entry = descriptors.find(
          candidate => candidate.canDeriveScriptPubKeys && candidate.descriptor,
        )

        if (!entry?.descriptor) {
          throw new WalletCapabilityUnavailableError(
            'hand out an address',
            'The wallet returned no descriptor a script can be derived from.',
          )
        }

        return entry.descriptor
      },
      async getBalance(assetId: string) {
        if (!client) throw new WalletNotConnectedError('reading a balance')

        const { balance } = await client.getBalance({ assetId: walletAssetId(assetId) })

        return balance
      },
      async getUtxos(assetId: string): Promise<WalletUtxo[]> {
        if (!client) throw new WalletNotConnectedError('reading spendable outputs')

        const { utxos } = await client.getUTXOs({ assetId: walletAssetId(assetId) })

        return utxos.map(utxo => ({
          txid: utxo.txid,
          vout: utxo.vout,
          assetId: utxo.assetId,
          amount: utxo.amount,
          address: utxo.address,
          scriptPubkey: utxo.scriptPubKey,
          confidential: utxo.confidential,
          spendable: utxo.spendable,
        }))
      },
      performAction(request: WalletActionRequest): Promise<WalletActionResult> {
        if (!client) return Promise.reject(new WalletNotConnectedError('performing an action'))

        // The request reaches the wallet unchanged, so a refusal is the wallet's own rather
        // than a local guess about what it can do. Filling the request in is the action work.
        return client.processConfidentialTransaction(request)
      },
    }
  }, [provider])
}

/**
 * The HUMID browser extension, as one wallet behind the facade.
 *
 * Connecting is asked for directly rather than through a wallet chooser: this dapp offers one
 * wallet, and the chooser's own close event is not a reliable answer to "did the approval
 * fail" — it is the same event whether the window did its job or was dismissed. Asking the
 * connection layer gives a promise that resolves on an approved session and rejects on a
 * refusal, so a failure is reported once, by whoever asked for it.
 */
export function useHumidWallet(): WalletAdapter {
  const injected = useInjectedPresence()
  const { address, isConnected, status } = useAppKitAccount({ namespace: WALLET_NAMESPACE })
  const { walletProvider } = useAppKitProvider<CaipRpcProvider | undefined>(WALLET_NAMESPACE)
  const [connecting, setConnecting] = useState(false)

  const capabilities = useCapabilities(walletProvider)

  const unavailableReason = WALLET_CHAIN_UNSUPPORTED_REASON ?? (injected ? null : NOT_INSTALLED)

  const connect = useCallback(async () => {
    if (unavailableReason) throw new WalletUnavailableError(unavailableReason)

    setConnecting(true)
    try {
      // The connector list is built while the page loads, so it is read when the person asks
      // rather than closed over at render — a press during start-up waits instead of refusing.
      await appKit.ready()

      const wallet = appKit
        .getWalletList()
        .wallets.find(candidate => candidate.id === HUMID_CONNECTOR.id)

      if (!wallet) throw new WalletUnavailableError(NOT_INSTALLED)

      try {
        await appKit.connectWallet(wallet, WALLET_NAMESPACE)
      } catch (cause) {
        throw new WalletConnectionRefusedError(undefined, { cause })
      }
    } finally {
      setConnecting(false)
    }
  }, [unavailableReason])

  const disconnect = useCallback(() => appKit.disconnect(WALLET_NAMESPACE), [])

  const openAccount = useCallback(() => {
    void appKit.open({ view: 'Account', namespace: WALLET_NAMESPACE })
  }, [])

  return useMemo(() => {
    const chainId = WALLET_CHAIN_ID
    const connected = isConnected && address !== undefined && chainId !== null

    return {
      id: HUMID_CONNECTOR.id,
      name: HUMID_CONNECTOR.name,
      isAvailable: unavailableReason === null,
      unavailableReason,
      state: unavailableReason
        ? 'unavailable'
        : connected
          ? 'connected'
          : connecting
            ? 'connecting'
            : 'disconnected',
      account: connected ? { address, chainId } : null,
      restoring: status === 'reconnecting',
      connect,
      disconnect,
      openAccount,
      capabilities,
    }
  }, [
    address,
    capabilities,
    connect,
    connecting,
    disconnect,
    isConnected,
    openAccount,
    status,
    unavailableReason,
  ])
}
