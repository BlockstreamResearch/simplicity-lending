import { useState } from 'react'

import { UiButton } from '@/components/ui/UiButton'
import { UiTextField } from '@/components/ui/UiTextField'
import { useLiquidateOfferAction } from '@/hooks/useLiquidateOfferAction'
import { useTxStatus } from '@/hooks/useTxStatus'
import { useWallet } from '@/providers/walletFacade/useWallet'

import { TxResult } from './TxResult'

/**
 * Liquidating a defaulted position through the wallet, from an offer id and nothing else.
 *
 * The page it supersedes asked for outpoints, because it built the transaction here. The
 * deployment comes from the indexer, the active loan covenant comes with it, and the wallet
 * finds the lender NFT, burns it, takes the collateral and declares the height the covenant's
 * own time lock requires.
 */

interface RunState {
  busy: boolean
  error: string | null
  txid: string | null
}

const IDLE: RunState = { busy: false, error: null, txid: null }

export default function LiquidateOfferActionDemo() {
  const { connectionStatus } = useWallet()
  const liquidateOffer = useLiquidateOfferAction()

  const [offerId, setOfferId] = useState('')
  const [state, setState] = useState<RunState>(IDLE)
  const { status: txStatus } = useTxStatus(state.txid)

  const run = async () => {
    setState({ ...IDLE, busy: true })
    try {
      const { txid } = await liquidateOffer(offerId.trim())

      setState({ busy: false, error: null, txid })
    } catch (error) {
      setState({ ...IDLE, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <div className='rounded border border-gray-300 bg-white p-4'>
      <div className='font-bold'>Liquidate Offer</div>
      <p className='mt-2 max-w-3xl text-sm text-gray-600'>
        Asks the wallet to perform the protocol&rsquo;s own liquidation: past the loan&rsquo;s
        expiration height it spends the active loan covenant, burns the lender NFT this wallet holds
        and takes the collateral. Nothing here builds that transaction.
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
          {state.busy ? 'Waiting for the wallet…' : 'Liquidate Offer'}
        </UiButton>
      </div>

      {state.error && <p className='mt-3 text-xs text-red-500'>{state.error}</p>}

      <div className='mt-4'>
        <TxResult title='Position Liquidated' txid={state.txid} txStatus={txStatus} />
      </div>
    </div>
  )
}
