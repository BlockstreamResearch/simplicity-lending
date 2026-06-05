import { getTxExplorerUrl } from '@/api/esplora/utils'

export function TxResult({
  title,
  txid,
  confirmations,
  detail,
}: {
  title: string
  txid: string | null
  confirmations: number | null
  detail?: object
}) {
  if (!txid) return null

  return (
    <div className='rounded border border-gray-200 p-3'>
      <div className='font-semibold'>{title}</div>
      <a
        className='break-all text-sm text-blue-600 underline'
        href={getTxExplorerUrl(txid)}
        rel='noreferrer'
        target='_blank'
      >
        {txid}
      </a>
      <div className='mt-1 text-xs text-gray-600'>
        Confirmations: {confirmations === null ? 'waiting…' : confirmations}
      </div>
      {detail && (
        <pre className='mt-2 overflow-x-auto rounded bg-gray-100 p-2 text-xs'>
          {JSON.stringify(detail, null, 2)}
        </pre>
      )}
    </div>
  )
}
