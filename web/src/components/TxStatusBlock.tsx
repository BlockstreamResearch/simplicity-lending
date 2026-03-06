/**
 * Standardized block under Build/Sign/Broadcast buttons: unsigned hex, signed hex, or single error.
 * Show only one at a time: error takes priority, then signed, then unsigned.
 */

import { ButtonNeutral } from './Button'

export interface TxStatusBlockProps {
  unsignedTxHex?: string | null
  signedTxHex?: string | null
  error?: string | null
}

export function TxStatusBlock({ unsignedTxHex, signedTxHex, error }: TxStatusBlockProps) {
  if (error?.trim()) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        {error}
      </div>
    )
  }
  if (signedTxHex?.trim()) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
        <p className="font-medium text-gray-700 mb-1">Signed transaction (hex)</p>
        <textarea
          readOnly
          className="w-full font-mono text-xs text-gray-900 bg-white border border-gray-200 rounded-lg p-2 h-24"
          value={signedTxHex}
        />
        <ButtonNeutral
          size="sm"
          className="mt-2"
          onClick={() => void navigator.clipboard?.writeText(signedTxHex)}
        >
          Copy hex
        </ButtonNeutral>
      </div>
    )
  }
  if (unsignedTxHex?.trim()) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
        <p className="font-medium text-gray-700 mb-1">Unsigned transaction (hex)</p>
        <textarea
          readOnly
          className="w-full font-mono text-xs text-gray-900 bg-white border border-gray-200 rounded-lg p-2 h-24"
          value={unsignedTxHex}
        />
        <ButtonNeutral
          size="sm"
          className="mt-2"
          onClick={() => void navigator.clipboard?.writeText(unsignedTxHex)}
        >
          Copy hex
        </ButtonNeutral>
      </div>
    )
  }
  return null
}
