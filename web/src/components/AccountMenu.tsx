import { useEffect, useRef, useState } from 'react'
import { CopyIcon } from './CopyIcon'

const EXPLORER_ADDRESS_URL = 'https://blockstream.info/liquidtestnet/address/'

function shortAddress(addr: string, head = 8, tail = 4): string {
  if (addr.length <= head + tail) return addr
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`
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

export function AccountMenu({
  status,
  address,
  error,
  onConnect,
  onDisconnect,
  onRefresh,
}: {
  status: 'initializing' | 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error'
  address: string | null
  error: string | null
  onConnect: () => Promise<void>
  onDisconnect: () => Promise<void>
  onRefresh: () => Promise<void>
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [activeAction, setActiveAction] = useState<'connect' | 'disconnect' | 'refresh' | null>(
    null
  )
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const handleCopyAddress = async () => {
    if (!address) return
    await navigator.clipboard.writeText(address)
  }

  const handleConnect = async () => {
    setActiveAction('connect')
    try {
      await onConnect()
      setIsOpen(false)
    } finally {
      setActiveAction(null)
    }
  }

  const handleDisconnect = async () => {
    setActiveAction('disconnect')
    try {
      await onDisconnect()
      setIsOpen(false)
    } finally {
      setActiveAction(null)
    }
  }

  const handleRefresh = async () => {
    setActiveAction('refresh')
    try {
      await onRefresh()
    } finally {
      setActiveAction(null)
    }
  }

  const label =
    status === 'connected' && address
      ? shortAddress(address)
      : status === 'connecting' || status === 'disconnecting'
        ? 'Wallet…'
        : 'Connect Wallet'

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="rounded-full bg-neutral-950 px-5 py-3 text-base font-medium text-white hover:bg-neutral-800 sm:px-6"
      >
        {label}
      </button>

      {isOpen ? (
        <div
          className="absolute right-0 top-full z-50 mt-3 w-[21.5rem] max-w-[calc(100vw-2rem)] rounded-[1.6rem] border border-neutral-200 bg-white p-5 shadow-[0_24px_64px_rgba(0,0,0,0.14)] sm:w-[23rem] sm:p-6"
          role="dialog"
          aria-label="Wallet session menu"
        >
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="max-w-[11.5rem] sm:max-w-[13.5rem]">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-500">
                  Wallet Session
                </p>
                <p className="mt-2 text-sm text-neutral-600">
                  {status === 'connected'
                    ? 'Connected through WalletConnect.'
                    : 'Use the Blockstream app to approve Wallet ABI requests.'}
                </p>
              </div>
              <span
                className={`rounded-full px-3.5 py-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.2em] ${
                  status === 'connected'
                    ? 'bg-emerald-100 text-emerald-700'
                    : status === 'error'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-stone-100 text-stone-600'
                }`}
              >
                {status}
              </span>
            </div>

            {address ? (
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">
                  Receive Address
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-xl bg-white px-3 py-2 font-mono text-xs text-neutral-800 shadow-sm">
                    {address}
                  </code>
                  <button
                    type="button"
                    onClick={() => void handleCopyAddress()}
                    title="Copy address"
                    aria-label="Copy address"
                    className="shrink-0 rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  >
                    <CopyIcon className="h-4 w-4" />
                  </button>
                  <a
                    href={`${EXPLORER_ADDRESS_URL}${encodeURIComponent(address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View in explorer"
                    aria-label="View in explorer"
                    className="shrink-0 rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  >
                    <ExternalLinkIcon className="h-4 w-4" />
                  </a>
                </div>
              </div>
            ) : null}

            {error ? (
              <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {status === 'connected' ? (
                <>
                  <button
                    type="button"
                    onClick={() => void handleRefresh()}
                    disabled={activeAction != null || status !== 'connected'}
                    className="rounded-full border border-neutral-300 bg-white px-5 py-2.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Refresh Identity
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDisconnect()}
                    disabled={activeAction === 'disconnect'}
                    className="rounded-full bg-neutral-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                </>
              ) : status === 'connecting' || status === 'disconnecting' || status === 'error' ? (
                <>
                  <button
                    type="button"
                    onClick={() => void handleConnect()}
                    disabled={
                      status !== 'error' ||
                      activeAction === 'connect' ||
                      activeAction === 'disconnect'
                    }
                    className="rounded-full bg-neutral-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Reconnect
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDisconnect()}
                    disabled={status === 'disconnecting' || activeAction === 'disconnect'}
                    className="rounded-full border border-neutral-300 bg-white px-5 py-2.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Drop Connection
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleConnect()}
                  disabled={activeAction != null || status === 'initializing'}
                  className="rounded-full bg-neutral-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Connect Blockstream Wallet
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
