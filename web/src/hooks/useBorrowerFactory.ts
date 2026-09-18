import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import { useFactories } from '@/api/indexer/hooks'
import { factoryQueryKeys } from '@/api/indexer/queryKeys'
import type { FactoryDetails } from '@/api/indexer/schemas'
import { useWallet } from '@/providers/walletFacade/useWallet'

/**
 * The factory this account borrows through, as the indexer reports it.
 *
 * Reading only. Creating one is an action the wallet performs from the protocol's document —
 * see `useProtocolAction` — and the two were one hook while the page still built that
 * transaction itself.
 */
export interface FactoryState {
  factoryAssetId: string
  factoryAuthOutpoint: string
  issuanceFactoryOutpoint: string
}

function prepareFactory(factory: FactoryDetails): FactoryState | null {
  if (!factory.auth_utxo || !factory.program_utxo) return null

  return {
    factoryAssetId: factory.factory_asset_id,
    factoryAuthOutpoint: `${factory.auth_utxo.txid}:${factory.auth_utxo.vout}`,
    issuanceFactoryOutpoint: `${factory.program_utxo.txid}:${factory.program_utxo.vout}`,
  }
}

export function useBorrowerFactory() {
  const { scriptPubkey } = useWallet()
  const queryClient = useQueryClient()
  const factoriesQuery = useFactories(scriptPubkey || '')
  const activeFactory = factoriesQuery.data?.[0] ?? null

  const factoryState = useMemo(
    () => (activeFactory ? prepareFactory(activeFactory) : null),
    [activeFactory],
  )

  const refetchFactory = useCallback((): void => {
    if (!scriptPubkey) return

    queryClient.invalidateQueries({ queryKey: factoryQueryKeys.byScript(scriptPubkey) })
  }, [scriptPubkey, queryClient])

  return {
    factoryState,
    hasAccount: !!activeFactory,
    refetchFactory,
    scriptPubkey,
  }
}
