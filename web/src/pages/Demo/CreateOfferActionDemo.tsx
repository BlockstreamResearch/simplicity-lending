import { useState } from 'react'

import { UiButton } from '@/components/ui/UiButton'
import { UiTextField } from '@/components/ui/UiTextField'
import { useBorrowerFactory } from '@/hooks/useBorrowerFactory'
import { useCreateOfferAction } from '@/hooks/useCreateOfferAction'
import { useTxStatus } from '@/hooks/useTxStatus'
import { useWallet } from '@/providers/walletFacade/useWallet'

import { TxResult } from './TxResult'

/**
 * Creating an offer through the wallet, with the four numbers a lender actually chooses.
 *
 * The page it supersedes asked for outpoints, asset ids and a factory, because it built the
 * transaction here. None of that is a person's to supply any more: the factory comes from the
 * indexer, the asset ids from this deployment's configuration, and which outputs pay for it is
 * the wallet's to decide from the document.
 */

const DEFAULTS = {
  collateralAmount: '3000',
  interestRateBps: '1000',
  loanDurationBlocks: '144',
  principalAmount: '100',
}

interface RunState {
  busy: boolean
  deployment: Record<string, string> | null
  error: string | null
  txid: string | null
}

const IDLE: RunState = { busy: false, deployment: null, error: null, txid: null }

export default function CreateOfferActionDemo() {
  const { connectionStatus } = useWallet()
  const { factoryState } = useBorrowerFactory()
  const createOffer = useCreateOfferAction()

  const [form, setForm] = useState(DEFAULTS)
  const [state, setState] = useState<RunState>(IDLE)
  const { status: txStatus } = useTxStatus(state.txid)

  const field = (name: keyof typeof DEFAULTS) => ({
    onChange: (value: string) => setForm(current => ({ ...current, [name]: value })),
    value: form[name],
  })

  const run = async () => {
    setState({ ...IDLE, busy: true })
    try {
      const { deployment, txid } = await createOffer({
        collateralAmount: BigInt(form.collateralAmount),
        loanDurationBlocks: Number.parseInt(form.loanDurationBlocks, 10),
        principalAmount: BigInt(form.principalAmount),
        principalInterestRateBps: Number.parseInt(form.interestRateBps, 10),
      })

      setState({ busy: false, deployment, error: null, txid })
    } catch (error) {
      setState({
        ...IDLE,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <div className='rounded border border-gray-300 bg-white p-4'>
      <div className='font-bold'>Create Offer</div>
      <p className='mt-2 max-w-3xl text-sm text-gray-600'>
        Asks the wallet to perform the protocol&rsquo;s own offer creation: it spends the factory
        covenant and its auth NFT, mints the borrower and lender tokens, locks the collateral in the
        lending covenant and publishes the offer record. Nothing here builds that transaction.
      </p>

      {factoryState ? null : (
        <p className='mt-2 text-xs text-amber-600'>
          No factory yet — create a borrower account first.
        </p>
      )}

      <div className='mt-4 grid gap-3 md:grid-cols-4'>
        <UiTextField label='Collateral (sats)' {...field('collateralAmount')} />
        <UiTextField label='Principal (base units)' {...field('principalAmount')} />
        <UiTextField label='Interest (bps)' {...field('interestRateBps')} />
        <UiTextField label='Term (blocks)' {...field('loanDurationBlocks')} />
      </div>

      <div className='mt-4'>
        <UiButton
          isDisabled={connectionStatus !== 'ready' || state.busy}
          onPress={() => {
            void run()
          }}
        >
          {state.busy ? 'Waiting for the wallet…' : 'Create Offer'}
        </UiButton>
      </div>

      {state.error && <p className='mt-3 text-xs text-red-500'>{state.error}</p>}

      <div className='mt-4'>
        <TxResult
          title='Offer Created'
          txid={state.txid}
          txStatus={txStatus}
          detail={state.deployment ?? undefined}
        />
      </div>
    </div>
  )
}
