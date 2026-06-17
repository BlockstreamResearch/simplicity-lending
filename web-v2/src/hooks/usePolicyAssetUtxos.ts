import { useQuery } from '@tanstack/react-query'

import { isPolicyAssetUtxo, utxoToOutpointString } from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'

export interface PolicyAssetUtxo {
  outpoint: string
  value: bigint
}

interface UsePolicyAssetUtxosResult {
  utxos: PolicyAssetUtxo[]
  isLoading: boolean
}

export function usePolicyAssetUtxos(enabled: boolean): UsePolicyAssetUtxosResult {
  const { lwkNetwork } = useLwk()
  const { getBlindedWalletUtxos, scriptPubkey } = useWallet()

  const { data, isLoading } = useQuery({
    queryKey: ['wallet', 'policy-asset-utxos', scriptPubkey],
    enabled,
    staleTime: 0,
    queryFn: () => getBlindedWalletUtxos(),
    select: utxos =>
      utxos
        .filter(utxo => isPolicyAssetUtxo(utxo, lwkNetwork.policyAsset()))
        .map(utxo => ({ outpoint: utxoToOutpointString(utxo), value: utxo.unblinded().value() })),
  })

  return { utxos: data ?? [], isLoading: enabled && isLoading }
}
