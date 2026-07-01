import { useState } from 'react'

import { broadcastTx } from '@/api/esplora/methods'
import { getDefaultTransactionSteps } from '@/components/TransactionStepper/transactionSteps'
import { type BorrowerAccountCreationSummary, useBorrowerAccount } from '@/hooks/useBorrowerAccount'
import { useTxStatus } from '@/hooks/useTxStatus'
import { useTxProgress } from '@/providers/txProgress/useTxProgress'
import { useWallet } from '@/providers/wallet/useWallet'

import { TxResult } from './TxResult'

interface BroadcastState<TResult> {
  busy: boolean
  error: string | null
  result: TResult | null
}

const INITIAL_STATE = { busy: false, error: null, result: null }

export default function CreateBorrowerAccountDemo() {
  const { connectionStatus, signPset, signerType } = useWallet()
  const { createBorrowerAccount, removeBorrowerAccount } = useBorrowerAccount()
  const { start, fail } = useTxProgress()

  const [createState, setCreateState] =
    useState<BroadcastState<{ txid: string; summary: BorrowerAccountCreationSummary }>>(
      INITIAL_STATE,
    )
  const [removeState, setRemoveState] = useState<BroadcastState<null>>(INITIAL_STATE)

  const { status: createTxStatus } = useTxStatus(createState.result?.txid ?? null)
  const { status: removeTxStatus } = useTxStatus(null)

  const handleCreate = async () => {
    setCreateState({ busy: true, error: null, result: null })
    try {
      const advance = await start(getDefaultTransactionSteps(signerType))
      const { pset, finalize } = await createBorrowerAccount()
      await advance('signing')
      const signedPset = await signPset(pset)
      await advance('finalizing')
      const { finalizedTx, summary } = finalize(signedPset)
      await advance('broadcasting')
      const txid = await broadcastTx(finalizedTx.toString())

      setCreateState({ busy: false, error: null, result: { txid, summary } })
    } catch (err) {
      fail(err)
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
      await removeBorrowerAccount()
      setRemoveState({ busy: false, error: null, result: null })
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
          Creates a borrower account by issuing two units of a new auth asset from one wallet L-BTC
          input. One unit returns to the user as FactoryAuth, and one unit funds the IssuanceFactory
          covenant. Reissuance token amount is zero.
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
              detail={createState.result.summary}
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
