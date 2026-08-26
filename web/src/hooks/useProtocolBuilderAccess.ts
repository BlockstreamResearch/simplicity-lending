import { useMemo } from 'react'

import type { ProtocolBuilderAccess } from '@/lib/wallet/protocolBuilderAccess'
import { useLwk } from '@/providers/lwk/useLwk'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/walletFacade/useWallet'
import { getProcessingTxids } from '@/utils/pendingTransactions'

/** What a builder needs from the wallet, on a screen: the connected wallet, whichever it is. */
export function useProtocolBuilderAccess(): ProtocolBuilderAccess {
  const { lwkNetwork } = useLwk()
  const { getReceiveAddress, getBlindedWalletUtxos, getWollet, syncWallet } = useWallet()
  const { pendingTxs } = usePendingTransactions()

  const processingTxids = useMemo(() => getProcessingTxids(pendingTxs), [pendingTxs])

  return useMemo(
    () => ({
      lwkNetwork,
      getWollet,
      getBlindedWalletUtxos,
      getReceiveAddress,
      syncWallet,
      processingTxids,
    }),
    [getBlindedWalletUtxos, getReceiveAddress, getWollet, lwkNetwork, processingTxids, syncWallet],
  )
}
