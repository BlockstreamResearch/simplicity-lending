import { useCallback } from 'react'

import { getWalletActionSteps } from '@/components/TransactionStepper/transactionSteps'
import { type WalletActionOutcome, walletActionOutcome } from '@/lib/wallet/actionResult'
import { LENDING_PROTOCOL } from '@/protocol'
import { protocolActionRequest, type ProtocolState } from '@/protocol/actionRequest'
import { useTxProgress } from '@/providers/txProgress/useTxProgress'
import { useWallet } from '@/providers/walletFacade/useWallet'

/** One action of the deployed protocol, and whatever of it a person chose. */
export interface ChosenProtocolAction {
  action: string
  /** The deployment this action reads, for an action that reads one it did not create. */
  instance?: Record<string, string>
  params?: Record<string, unknown>
  /** The covenant outputs this action spends, for an action that spends one. */
  state?: ProtocolState
}

export type PerformProtocolAction = (chosen: ChosenProtocolAction) => Promise<WalletActionOutcome>

/**
 * Performs one action of the protocol by asking the wallet to.
 *
 * This is what replaces building a transaction in the page. The page has no key, no output set
 * and no wallet object; what it has is the document the deployment publishes, and that is what
 * travels. Everything the wallet needs about this protocol arrives with the request, so the
 * wallet learns nothing about lending by performing it.
 */
export function useProtocolAction(): PerformProtocolAction {
  const { performAction } = useWallet()
  const { startTxProgress, setTxProgressError } = useTxProgress()

  return useCallback<PerformProtocolAction>(
    async chosen => {
      try {
        // Started before the request leaves, because everything after that happens inside the
        // wallet: from here the action is one wait, and the person is waiting on their own
        // wallet window rather than on this page.
        startTxProgress(getWalletActionSteps())

        const answer = await performAction(protocolActionRequest(LENDING_PROTOCOL, chosen))

        return walletActionOutcome(chosen.action, answer)
      } catch (error) {
        setTxProgressError(error)
        throw error
      }
    },
    [performAction, setTxProgressError, startTxProgress],
  )
}
