import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { INDEXER_EVENT_NAMES, parseIndexerEvent } from '@/api/indexer/events'
import { invalidateEventQueries } from '@/api/indexer/invalidateEventQueries'
import { env } from '@/constants/env'
import { useLatestRef } from '@/hooks/useLatestRef'
import { useWallet } from '@/providers/wallet/useWallet'

export function IndexerSubscription(): null {
  const queryClient = useQueryClient()
  const { scriptPubkey } = useWallet()
  const contextRef = useLatestRef({ queryClient, scriptPubkey })

  useEffect(() => {
    const source = new EventSource(`${env.VITE_API_URL}/events`)

    const handle = (event: MessageEvent<string>) => {
      const parsed = parseIndexerEvent(event.data)
      if (parsed) invalidateEventQueries(parsed, contextRef.current)
    }

    for (const name of INDEXER_EVENT_NAMES) source.addEventListener(name, handle)

    return () => source.close()
  }, [contextRef])

  return null
}
