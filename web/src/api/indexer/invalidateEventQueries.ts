import type { QueryClient } from '@tanstack/react-query'

import { normalizeHex } from '@/utils/hex'

import type { IndexerEvent } from './events'
import { invalidateAllIndexerQueries } from './invalidateIndexerQueries'
import { borrowerQueryKeys, factoryQueryKeys, lenderQueryKeys, offersQueryKeys } from './queryKeys'

export interface InvalidateContext {
  queryClient: QueryClient
  scriptPubkey: string | null
}

function isOwnScript(eventScript: string, walletScript: string | null): boolean {
  return walletScript !== null && normalizeHex(eventScript) === normalizeHex(walletScript)
}

function assertNever(value: never): never {
  throw new Error(`Unhandled indexer event: ${JSON.stringify(value)}`)
}

export function invalidateEventQueries(
  event: IndexerEvent,
  { queryClient, scriptPubkey }: InvalidateContext,
): void {
  const invalidate = (queryKey: readonly unknown[]) => queryClient.invalidateQueries({ queryKey })

  switch (event.type) {
    case 'offer_created':
      invalidate(offersQueryKeys.lists())
      if (isOwnScript(event.borrower_script_pubkey, scriptPubkey)) {
        invalidate(borrowerQueryKeys.all())
      }
      break
    case 'offer_status_updated':
      invalidate(offersQueryKeys.detail(event.id))
      invalidate(offersQueryKeys.lists())
      invalidate(offersQueryKeys.overview())
      invalidate(borrowerQueryKeys.all())
      invalidate(lenderQueryKeys.all())
      break
    case 'factory_created':
      if (isOwnScript(event.factory_auth_script_pubkey, scriptPubkey)) {
        invalidate(factoryQueryKeys.byScript(event.factory_auth_script_pubkey))
      }
      break
    case 'block_indexed':
      invalidateAllIndexerQueries(queryClient)
      break

    default:
      assertNever(event)
  }
}
