import { useState } from 'react'

import { UiButton } from '@/components/ui/UiButton'
import { UiTextField } from '@/components/ui/UiTextField'
import { useClaimPrincipalAction } from '@/hooks/useClaimPrincipalAction'
import { useTxStatus } from '@/hooks/useTxStatus'
import { useWallet } from '@/providers/walletFacade/useWallet'

import { TxResult } from './TxResult'

/**
 * Claiming the principal through the wallet, from an offer id and nothing else.
 *
 * The page it supersedes asked for outpoints, because it built the transaction here. The
 * deployment comes from the indexer, the covenant holding the principal comes with it, and the
 * wallet finds the borrower NFT, presents it, hands it back and takes the principal.
 */

interface RunState {
  busy: boolean
  error: string | null
  txid: string | null
}

const IDLE: RunState = { busy: false, error: null, txid: null }

export default function ClaimPrincipalActionDemo() {
  const { connectionStatus } = useWallet()
  const claimPrincipal = useClaimPrincipalAction()

  const [offerId, setOfferId] = useState('')
  const [state, setState] = useState<RunState>(IDLE)
  const { status: txStatus } = useTxStatus(state.txid)

  const run = async () => {
    setState({ ...IDLE, busy: true })
    try {
      const { txid } = await claimPrincipal(offerId.trim())

      setState({ busy: false, error: null, txid })
    } catch (error) {
      setState({ ...IDLE, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <div className='rounded border border-gray-300 bg-white p-4'>
      <div className='font-bold'>Claim Principal</div>
      <p className='mt-2 max-w-3xl text-sm text-gray-600'>
        Asks the wallet to perform the protocol&rsquo;s own principal claim: it spends the covenant
        the principal was locked into at activation, presents the borrower NFT this wallet holds and
        re-outputs it, and pays the principal out. Nothing here builds that transaction.
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
          {state.busy ? 'Waiting for the wallet…' : 'Claim Principal'}
        </UiButton>
      </div>

      {state.error && <p className='mt-3 text-xs text-red-500'>{state.error}</p>}

      <div className='mt-4'>
        <TxResult title='Principal Claimed' txid={state.txid} txStatus={txStatus} />
      </div>
    </div>
  )
}
