import { useAppKitAccount } from '@reown/appkit/react'
import { type PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { appKit, HUMID_NAMESPACE } from '@/lib/humid/appkit'

import { HumidContext } from './HumidContext'
import type { HumidContextValue } from './types'

/** A `connect()` caller waiting on the wallet's answer. */
interface PendingConnect {
  resolve: () => void
  reject: (reason: Error) => void
}

// The extension injects its provider from a content script, so it is absent for the first
// tick of a fresh load. Three seconds of looking tells "not installed" apart from "not
// injected yet" without leaving the connect option greyed out on a slow load.
const EXTENSION_POLL_INTERVAL_MS = 250
const EXTENSION_POLL_ATTEMPTS = 12

const CONNECTION_REFUSED = 'The wallet did not approve the connection.'
const CONNECTION_ABANDONED = 'Connection cancelled before the wallet approved it.'

/**
 * Whether the humid extension has put its provider on the page. Starts false on a fresh
 * render and turns true on its own, so a false here is only final once the poll has run out.
 */
function useExtensionPresence(): boolean {
  const [present, setPresent] = useState(() => window.humid !== undefined)

  useEffect(() => {
    if (present) return

    let attempts = 0
    const timer = setInterval(() => {
      attempts += 1

      if (window.humid !== undefined) {
        setPresent(true)
        clearInterval(timer)
      } else if (attempts >= EXTENSION_POLL_ATTEMPTS) {
        clearInterval(timer)
      }
    }, EXTENSION_POLL_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [present])

  return present
}

/**
 * Turns the wallet's approval — which AppKit reports as a stream of events rather than a
 * return value — back into one promise a caller can await.
 *
 * The stream is subscribed to rather than read through a hook, because the hook keeps the
 * last event standing indefinitely: a second attempt would be answered by the first
 * attempt's own closing event before its window had even opened. A subscription only ever
 * delivers what has just happened.
 */
function useConnectFlow() {
  const [connecting, setConnecting] = useState(false)
  const pending = useRef<PendingConnect | null>(null)

  const settle = useCallback((failure: Error | null) => {
    const waiting = pending.current

    pending.current = null
    setConnecting(false)

    if (!waiting) return
    if (failure) waiting.reject(failure)
    else waiting.resolve()
  }, [])

  useEffect(
    () =>
      appKit.subscribeEvents(({ data }) => {
        if (!pending.current) return

        if (data.event === 'CONNECT_SUCCESS') {
          void appKit.close()
          settle(null)
          return
        }

        // Left open on purpose. The wallet's window is what a person is looking at when a
        // connection fails and it says so there; closing it would replace that with nothing.
        if (data.event === 'CONNECT_ERROR') {
          settle(new Error(CONNECTION_REFUSED))
          return
        }

        // The wallet chooser was dismissed. Whether that ended the attempt or merely closed
        // a window that had already done its job is only visible on the event itself.
        if (data.event === 'MODAL_CLOSE') {
          if (data.properties.connected) {
            void appKit.close()
            settle(null)
          } else {
            settle(new Error(CONNECTION_ABANDONED))
          }
        }
      }),
    [settle],
  )

  const connect = useCallback(async () => {
    // AppKit remembers the connector it last used. Asking it to connect while it believes
    // it already is opens an account view instead of an approval, so clear that first.
    try {
      await appKit.disconnect(HUMID_NAMESPACE)
    } catch {
      // Nothing was connected, which is the state this was trying to reach.
    }

    setConnecting(true)

    return new Promise<void>((resolve, reject) => {
      pending.current = { resolve, reject }
      void appKit.open({ view: 'Connect', namespace: HUMID_NAMESPACE })
    })
  }, [])

  return { connect, connecting }
}

/**
 * Owns this origin's connection to the humid extension: whether the extension is on the
 * page, whether an account is authorised, which account it is, and how that approval is
 * asked for and given up. Nothing else in the dapp reaches AppKit.
 */
export function HumidProvider({ children }: PropsWithChildren) {
  const { address, isConnected } = useAppKitAccount({ namespace: HUMID_NAMESPACE })

  const hasExtension = useExtensionPresence()
  const { connect, connecting } = useConnectFlow()

  const value = useMemo<HumidContextValue>(
    () => ({
      hasExtension,
      isConnected,
      account: address ?? null,
      connecting,
      connect,
      disconnect: () => appKit.disconnect(HUMID_NAMESPACE),
      openAccount: () => {
        void appKit.open({ view: 'Account', namespace: HUMID_NAMESPACE })
      },
    }),
    [hasExtension, isConnected, address, connecting, connect],
  )

  return <HumidContext.Provider value={value}>{children}</HumidContext.Provider>
}
