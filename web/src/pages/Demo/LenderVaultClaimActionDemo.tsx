import { useState } from 'react'

import { UiButton } from '@/components/ui/UiButton'
import { UiTextField } from '@/components/ui/UiTextField'
import { useLenderVaultClaimAction } from '@/hooks/useLenderVaultClaimAction'
import { useTxStatus } from '@/hooks/useTxStatus'
import { useWallet } from '@/providers/walletFacade/useWallet'

import { TxResult } from './TxResult'

/**
 * Collecting the lender's settlement through the wallet, from an offer id and nothing else.
 *
 * The page it supersedes asked for outpoints, because it built the transaction here. The
 * deployment comes from the indexer, the finalized vault comes with it, and the wallet finds
 * the lender NFT, burns it and takes the balance the repayment left there.
 */

interface RunState {
  busy: boolean
  error: string | null
  txid: string | null
}

const IDLE: RunState = { busy: false, error: null, txid: null }

export default function LenderVaultClaimActionDemo() {
  const { connectionStatus } = useWallet()
  const claimLenderVault = useLenderVaultClaimAction()

  const [offerId, setOfferId] = useState('')
  const [state, setState] = useState<RunState>(IDLE)
  const { status: txStatus } = useTxStatus(state.txid)

  const run = async () => {
    setState({ ...IDLE, busy: true })
    try {
      const { txid } = await claimLenderVault(offerId.trim())

      setState({ busy: false, error: null, txid })
    } catch (error) {
      setState({ ...IDLE, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <div className='rounded border border-gray-300 bg-white p-4'>
      <div className='font-bold'>Collect Lender Settlement</div>
      <p className='mt-2 max-w-3xl text-sm text-gray-600'>
        Asks the wallet to perform the protocol&rsquo;s own lender settlement: it spends the
        finalized lender vault a full repayment created, burns the lender NFT this wallet holds and
        pays the balance out. Nothing here builds that transaction.
      </p>

      <div className='mt-4 grid gap-3 md:grid-cols-4'>
        <UiTextField label='Offer id' onChange={setOfferId} value={offerId} />
      </div>

      <div className='mt-4'>
        <UiButton
          isDisabled={connectionStatus !== 'ready' || state.busy || offerId.trim() === ''}
          onPress={() => {
            void run()
          }}
        >
          {state.busy ? 'Waiting for the wallet…' : 'Collect Settlement'}
        </UiButton>
      </div>

      {state.error && <p className='mt-3 text-xs text-red-500'>{state.error}</p>}

      <div className='mt-4'>
        <TxResult title='Settlement Collected' txid={state.txid} txStatus={txStatus} />
      </div>
    </div>
  )
}
