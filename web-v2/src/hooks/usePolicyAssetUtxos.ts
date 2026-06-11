import { useQuery } from '@tanstack/react-query'

import { isPolicyAssetUtxo, utxoToOutpointString } from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'

export interface WalletUtxo {
  outpoint: string
  value: bigint
}

interface UsePolicyAssetUtxosResult {
  utxos: WalletUtxo[]
  isLoading: boolean
}

export function usePolicyAssetUtxos(enabled: boolean): UsePolicyAssetUtxosResult {
  const { lwkNetwork } = useLwk()
  const { getWalletUtxos, xOnlyPubkey } = useWallet()

  const { data, isLoading } = useQuery({
    queryKey: ['wallet', 'policy-asset-utxos', xOnlyPubkey],
    enabled,
    staleTime: 0,
    queryFn: async (): Promise<WalletUtxo[]> => {
      const policyAsset = lwkNetwork.policyAsset()
      const walletUtxos = await getWalletUtxos()
      return walletUtxos
        .filter(utxo => isPolicyAssetUtxo(utxo, policyAsset))
        .map(utxo => ({ outpoint: utxoToOutpointString(utxo), value: utxo.unblinded().value() }))
    },
  })

  return { utxos: data ?? [], isLoading: enabled && isLoading }
}
