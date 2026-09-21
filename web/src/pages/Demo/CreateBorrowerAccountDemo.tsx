import { useState } from 'react'

import { useProtocolAction } from '@/hooks/useProtocolAction'
import { useTxStatus } from '@/hooks/useTxStatus'
import { useWallet } from '@/providers/walletFacade/useWallet'

import { TxResult } from './TxResult'

interface BroadcastState<TResult> {
  busy: boolean
  error: string | null
  result: TResult | null
}

const INITIAL_STATE = { busy: false, error: null, result: null }

/** The action the deployed document declares for bringing a factory into existence. */
const CREATE_FACTORY = 'CreateFactory'

/*
 * Removing one is still not wired: giving a factory up spends the covenant, which needs a
 * signature over the whole transaction that neither this page nor the wallet's action path
 * produces today. It refused here before this page stopped building transactions, and it
 * refuses here now, for the same reason.
 */
const REMOVE_IS_UNWIRED =
  'Removing a borrower account is not wired: spending the factory covenant needs a signature ' +
  'over the whole transaction, which no path here produces yet.'

export default function CreateBorrowerAccountDemo() {
  const { connectionStatus } = useWallet()
  const performProtocolAction = useProtocolAction()

  const [createState, setCreateState] =
    useState<BroadcastState<{ txid: string; deployment: Record<string, string> | null }>>(
      INITIAL_STATE,
    )
  const [removeState, setRemoveState] = useState<BroadcastState<null>>(INITIAL_STATE)

  const { status: createTxStatus } = useTxStatus(createState.result?.txid ?? null)
  const { status: removeTxStatus } = useTxStatus(null)

  const handleCreate = async () => {
    setCreateState({ busy: true, error: null, result: null })
    try {
      const { txid, deployment } = await performProtocolAction({ action: CREATE_FACTORY })

      setCreateState({ busy: false, error: null, result: { txid, deployment } })
    } catch (err) {
      setCreateState({
        busy: false,
        error: err instanceof Error ? err.message : String(err),
        result: null,
      })
    }
  }

  const handleRemove = async () => {
    setRemoveState({ busy: true, error: null, result: null })
    try {
      throw new Error(REMOVE_IS_UNWIRED)
    } catch (err) {
      setRemoveState({
        busy: false,
        error: err instanceof Error ? err.message : String(err),
        result: null,
      })
    }
  }

  const busy = createState.busy || removeState.busy
  const disabled = connectionStatus !== 'ready' || busy

  return (
    <div className='space-y-4'>
      <div className='rounded border border-gray-300 bg-white p-4'>
        <div className='font-bold'>Borrower Account IssuanceFactory Demo</div>
        <p className='mt-2 max-w-3xl text-sm text-gray-600'>
          Asks the wallet to perform the protocol&rsquo;s own factory creation from the deployed
          document: it issues two units of a new asset from one wallet L-BTC input, returns one as
          the owner&rsquo;s auth NFT, locks one in the IssuanceFactory covenant, and publishes the
          creation record. Nothing here builds that transaction.
        </p>

        <div className='mt-4 flex flex-wrap gap-2'>
          <button
            className='rounded bg-accent-soft-hover px-4 py-2 text-sm disabled:opacity-50'
            disabled={disabled}
            onClick={handleCreate}
          >
            {createState.busy ? 'Creating borrower account…' : 'Create Borrower Account'}
          </button>

          <button
            className='rounded border border-gray-300 px-4 py-2 text-sm disabled:opacity-50'
            disabled={disabled}
            onClick={handleRemove}
          >
            {removeState.busy ? 'Removing borrower account…' : 'Remove Borrower Account'}
          </button>
        </div>

        {createState.error && (
          <p className='mt-3 text-xs text-red-500'>Create: {createState.error}</p>
        )}
        {removeState.error && (
          <p className='mt-3 text-xs text-red-500'>Remove: {removeState.error}</p>
        )}

        <div className='mt-4 grid gap-4'>
          {createState.result && (
            <TxResult
              title='Borrower Account Created'
              txid={createState.result.txid}
              txStatus={createTxStatus}
              detail={createState.result.deployment ?? undefined}
            />
          )}
          {removeState.result !== undefined && removeState.error && (
            <TxResult title='Borrower Account Removed' txid={null} txStatus={removeTxStatus} />
          )}
        </div>
      </div>
    </div>
  )
}
