import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { INDEXER_EVENT_NAMES, parseIndexerEvent } from '@/api/indexer/events'
import { invalidateEventQueries } from '@/api/indexer/invalidateEventQueries'
import { env } from '@/constants/env'
import { useLatestRef } from '@/hooks/useLatestRef'
import { useWallet } from '@/providers/wallet/useWallet'

const INITIAL_RECONNECT_DELAY_MS = 5_000
const MAX_RECONNECT_DELAY_MS = 60_000

export function IndexerSubscription(): null {
  const queryClient = useQueryClient()
  const { scriptPubkey } = useWallet()
  const contextRef = useLatestRef({ queryClient, scriptPubkey })

  useEffect(() => {
    let source: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let reconnectDelay = INITIAL_RECONNECT_DELAY_MS

    const handle = (event: MessageEvent<string>) => {
      const parsed = parseIndexerEvent(event.data)
      if (parsed) invalidateEventQueries(parsed, contextRef.current)
    }

    const connect = () => {
      const current = new EventSource(`${env.VITE_API_URL}/events`)
      source = current

      for (const name of INDEXER_EVENT_NAMES) current.addEventListener(name, handle)

      current.addEventListener('open', () => {
        reconnectDelay = INITIAL_RECONNECT_DELAY_MS
      })

      // The browser retries dropped connections itself, but gives up for good on
      // a non-200 response (e.g. 429/503 when the subscriber limit is reached).
      current.addEventListener('error', () => {
        if (current.readyState !== EventSource.CLOSED) return

        current.close()
        reconnectTimer = setTimeout(connect, reconnectDelay * (0.5 + Math.random() * 0.5))
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
      })
    }

    connect()

    return () => {
      clearTimeout(reconnectTimer)
      source?.close()
    }
  }, [contextRef])

  return null
}
