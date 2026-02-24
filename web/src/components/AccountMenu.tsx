import { useState, useRef, useEffect } from 'react'
import { CopyIcon } from './CopyIcon'
import { ButtonPrimary, ButtonIconNeutral } from './Button'

const P2PK_NETWORK: 'testnet' | 'mainnet' = 'testnet'
const EXPLORER_ADDRESS_URL = 'https://blockstream.info/liquidtestnet/address/'

function shortAddress(addr: string, head = 8, tail = 3): string {
  if (addr.length <= head + tail) return addr
  return addr.slice(0, head) + '…' + addr.slice(-tail)
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  )
}

type Props = {
  accountIndex: number
  accountAddress: string | null
  addressLoading: boolean
  onAccountIndexChange: (index: number) => void
  onDisconnect: () => void
}

export function AccountMenu({
  accountIndex,
  accountAddress,
  addressLoading,
  onAccountIndexChange,
  onDisconnect,
}: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [indexInput, setIndexInput] = useState(String(accountIndex))
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setIndexInput(String(accountIndex))
  }, [accountIndex])

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const handleCopyAddress = () => {
    if (accountAddress) {
      void navigator.clipboard.writeText(accountAddress)
    }
  }

  const handleApplyIndex = () => {
    const n = parseInt(indexInput, 10)
    if (!Number.isNaN(n) && n >= 0) {
      onAccountIndexChange(n)
    } else {
      setIndexInput(String(accountIndex))
    }
  }

  const handleDisconnect = () => {
    setIsOpen(false)
    onDisconnect()
  }

  const label = addressLoading
    ? 'Loading…'
    : accountAddress
      ? shortAddress(accountAddress)
      : `Account ${accountIndex}`

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="rounded-lg bg-[#5F3DC4] px-3 py-1.5 text-sm font-medium text-white
                   hover:bg-[#4f36a8] focus:ring-2 focus:ring-[#5F3DC4] focus:ring-offset-1
                   font-mono max-w-[180px] truncate"
        title={accountAddress ?? undefined}
      >
        {label}
      </button>

      {isOpen && (
        <div
          className="absolute right-0 top-full mt-2 w-80 rounded-lg border border-gray-200 bg-white py-4 px-4 shadow-lg z-50"
          role="dialog"
          aria-label="Account menu"
        >
          <div className="space-y-4">
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">
                Address (P2PK, {P2PK_NETWORK})
              </p>
              {addressLoading ? (
                <p className="text-sm text-gray-500">Loading…</p>
              ) : accountAddress ? (
                <div className="flex items-center gap-1">
                  <code className="flex-1 min-w-0 text-xs font-mono text-gray-800 break-all bg-gray-50 px-2 py-1.5 rounded">
                    {accountAddress}
                  </code>
                  <ButtonIconNeutral
                    onClick={handleCopyAddress}
                    title="Copy address"
                    aria-label="Copy address"
                    className="shrink-0"
                  >
                    <CopyIcon className="h-4 w-4" />
                  </ButtonIconNeutral>
                  <a
                    href={`${EXPLORER_ADDRESS_URL}${encodeURIComponent(accountAddress)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View in explorer"
                    aria-label="View in explorer"
                    className="shrink-0 rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  >
                    <ExternalLinkIcon className="h-4 w-4" />
                  </a>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Failed to load address</p>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Account index</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  value={indexInput}
                  onChange={(e) => setIndexInput(e.target.value)}
                  onBlur={handleApplyIndex}
                  onKeyDown={(e) => e.key === 'Enter' && handleApplyIndex()}
                  className="w-24 rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-900
                             [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
                />
                <ButtonPrimary size="sm" onClick={handleApplyIndex}>
                  Switch
                </ButtonPrimary>
              </div>
            </div>

            <div className="pt-2 border-t border-gray-200">
              <ButtonPrimary size="md" className="w-full" onClick={handleDisconnect}>
                Disconnect
              </ButtonPrimary>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
