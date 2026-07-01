import { useCallback } from 'react'

import { broadcastTx } from '@/api/esplora/methods'
import { getDefaultTransactionSteps } from '@/components/TransactionStepper/transactionSteps'
import type { UpdatedPset } from '@/lwk/transaction'
import { useTxProgress } from '@/providers/txProgress/useTxProgress'
import { useWallet } from '@/providers/wallet/useWallet'

export interface TransactionFlowResult<TSummary> {
  txid: string
  summary: TSummary
}

type RunDefaultTransactionFlow = <TSummary>(
  build: () => Promise<UpdatedPset<TSummary>>,
) => Promise<TransactionFlowResult<TSummary>>

export function useDefaultTransactionFlow(): RunDefaultTransactionFlow {
  const { signPset, signerType } = useWallet()
  const { startTxProgress, setTxProgressError } = useTxProgress()

  return useCallback<RunDefaultTransactionFlow>(
    async build => {
      try {
        const advance = startTxProgress(getDefaultTransactionSteps(signerType))
        const { pset, finalize } = await build()

        await advance('signing')
        const signedPset = await signPset(pset)

        await advance('finalizing')
        const { finalizedTx, summary } = finalize(signedPset)

        await advance('broadcasting')
        const txid = await broadcastTx(finalizedTx.toString())

        return { txid, summary }
      } catch (error) {
        setTxProgressError(error)
        throw error
      }
    },
    [setTxProgressError, signPset, signerType, startTxProgress],
  )
}
