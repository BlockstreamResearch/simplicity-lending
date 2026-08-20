import { useState } from 'react'

import { UiButton } from '@/components/ui/UiButton'
import { UiTextField } from '@/components/ui/UiTextField'
import { useCancelOfferAction } from '@/hooks/useCancelOfferAction'
import { useTxStatus } from '@/hooks/useTxStatus'
import { useWallet } from '@/providers/walletFacade/useWallet'

import { TxResult } from './TxResult'

/**
 * Cancelling an offer through the wallet, from its id and nothing else.
 *
 * The page it supersedes asked for four outpoints and an address, because it built the
 * transaction here. None of them is a person's to supply any more: the deployment comes from the
 * indexer, the two covenants it spends come with it, and the wallet finds the borrower NFT it
 * holds, burns both tokens and returns the collateral where the document says.
 */

interface RunState {
  busy: boolean
  error: string | null
  txid: string | null
}

const IDLE: RunState = { busy: false, error: null, txid: null }

export default function CancelOfferActionDemo() {
  const { connectionStatus } = useWallet()
  const cancelOffer = useCancelOfferAction()

  const [offerId, setOfferId] = useState('')
  const [state, setState] = useState<RunState>(IDLE)
  const { status: txStatus } = useTxStatus(state.txid)

  const run = async () => {
    setState({ ...IDLE, busy: true })
    try {
      const { txid } = await cancelOffer(offerId.trim())

      setState({ busy: false, error: null, txid })
    } catch (error) {
      setState({ ...IDLE, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <div className='rounded border border-gray-300 bg-white p-4'>
      <div className='font-bold'>Cancel Offer</div>
      <p className='mt-2 max-w-3xl text-sm text-gray-600'>
        Asks the wallet to perform the protocol&rsquo;s own cancellation: it spends the pending
        lending covenant, the lender NFT held beside it and the borrower NFT this wallet holds,
        burns both tokens and returns the collateral. Nothing here builds that transaction.
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
          {state.busy ? 'Waiting for the wallet…' : 'Cancel Offer'}
        </UiButton>
      </div>

      {state.error && <p className='mt-3 text-xs text-red-500'>{state.error}</p>}

      <div className='mt-4'>
        <TxResult title='Offer Cancelled' txid={state.txid} txStatus={txStatus} />
      </div>
    </div>
  )
}
