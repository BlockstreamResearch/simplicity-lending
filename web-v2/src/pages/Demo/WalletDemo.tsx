import type { XOnlyPublicKey } from 'lwk_web'
import { useEffect, useState } from 'react'

import { env } from '@/constants/env'
import {
  type ConnectionStatus,
  DEFAULT_WALLET_TYPE,
  type WalletType,
} from '@/lib/wallet-core/types'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'

type Phase = 'no-usb' | 'usb-detected' | 'connecting' | 'locked' | 'ready'

function resolvePhase(
  connectionStatus: ConnectionStatus,
  usbDeviceDetected: boolean,
  syncing: boolean,
): Phase {
  if (connectionStatus === 'locked') return 'locked'
  if (connectionStatus === 'ready') return 'ready'
  if (syncing) return 'connecting'
  return usbDeviceDetected ? 'usb-detected' : 'no-usb'
}

export function WalletDemo() {
  const { network, isTestnet, isMainnet, isRegtest } = useLwk()
  const {
    connectionStatus,
    syncing,
    isError,
    error,
    balances,
    usbDeviceDetected,
    connect,
    getReceiveAddress,
    verifyReceiveAddress,
    getXOnlyPublicKey,
    connectorId,
  } = useWallet()

  const [walletType, setWalletType] = useState<WalletType>(DEFAULT_WALLET_TYPE)
  const [sendAddress, setSendAddress] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [verifyingAddress, setVerifyingAddress] = useState(false)
  const [xOnlyPubKey, setXOnlyPubKey] = useState<XOnlyPublicKey | null>(null)
  const [receiveAddress, setReceiveAddress] = useState<string | null>(null)

  useEffect(() => {
    if (connectionStatus !== 'ready') return
    let cancelled = false
    getXOnlyPublicKey()
      .then(key => {
        if (!cancelled) setXOnlyPubKey(key)
      })
      .catch(console.warn)
    return () => {
      cancelled = true
    }
  }, [connectionStatus, getXOnlyPublicKey])

  useEffect(() => {
    if (connectionStatus !== 'ready') return
    let cancelled = false
    getReceiveAddress()
      .then(addr => {
        if (!cancelled) setReceiveAddress(addr)
      })
      .catch(console.warn)
    return () => {
      cancelled = true
    }
  }, [connectionStatus, getReceiveAddress])

  const phase = resolvePhase(connectionStatus, usbDeviceDetected, syncing)

  const handleVerifyAddress = async () => {
    setVerifyingAddress(true)
    console.warn('[Dashboard] handleVerifyAddress: requesting address verification on device...')
    try {
      const addr = await verifyReceiveAddress()
      console.warn('[Dashboard] handleVerifyAddress: device confirmed address →', addr)
    } catch (err) {
      console.warn('[Dashboard] handleVerifyAddress: error', err)
    } finally {
      setVerifyingAddress(false)
    }
  }

  return (
    <div className='space-y-4'>
      {phase === 'no-usb' && (
        <div className='space-y-3'>
          <div className='flex gap-2'>
            <button
              className='rounded bg-accent-soft-hover px-4 py-2'
              onClick={() => connect(walletType)}
            >
              Connect Jade
            </button>
          </div>
          {env.VITE_DEBUG_MNEMONIC && (
            <>
              <button
                className='rounded bg-accent-soft-hover px-4 py-2'
                onClick={() => connect(walletType)}
              >
                Connect wallet
              </button>
            </>
          )}
        </div>
      )}

      {phase === 'usb-detected' && (
        <div className='space-y-3'>
          <div className='flex items-center gap-3'>
            <span className='text-sm font-medium'>Wallet type</span>
            <label className='flex items-center gap-1 text-sm'>
              <input
                type='radio'
                value='Wpkh'
                checked={walletType === 'Wpkh'}
                onChange={() => setWalletType('Wpkh')}
              />
              Native SegWit (wpkh)
            </label>
            <label className='flex items-center gap-1 text-sm'>
              <input
                type='radio'
                value='ShWpkh'
                checked={walletType === 'ShWpkh'}
                onChange={() => setWalletType('ShWpkh')}
              />
              Nested SegWit (sh-wpkh)
            </label>
          </div>
          <div className='flex gap-2'>
            <button
              className='rounded bg-accent-soft-hover px-4 py-2'
              onClick={() => connect(walletType)}
            >
              Connect Jade
            </button>
          </div>
        </div>
      )}

      {phase === 'connecting' && <p className='text-sm text-gray-500'>Connecting to Jade...</p>}

      {phase === 'locked' && (
        <div className='space-y-1'>
          <p className='text-sm'>
            Enter PIN on device
            {connectorId && <span className='ml-2 text-xs text-gray-500'>({connectorId})</span>}
          </p>
          {syncing && <p className='text-xs text-gray-400'>Loading wallet...</p>}
        </div>
      )}

      {phase === 'ready' && (
        <div className='space-y-4'>
          <div className='space-y-1'>
            <p className='text-sm font-medium'>Receive address</p>
            <code className='break-all text-xs'>{receiveAddress}</code>
            <button
              className='mt-1 rounded bg-accent-soft-hover px-3 py-1 text-xs disabled:opacity-50'
              disabled={verifyingAddress}
              onClick={handleVerifyAddress}
            >
              {verifyingAddress ? 'Confirm on device…' : 'Verify on Jade'}
            </button>
          </div>

          <div className='space-y-1'>
            <p className='text-sm font-medium'>
              Balances
              {connectorId && <span className='ml-2 text-xs text-gray-500'>({connectorId})</span>}
            </p>
            {syncing ? (
              <p className='text-xs text-gray-400'>Syncing...</p>
            ) : Object.entries(balances).length === 0 ? (
              <p className='text-sm text-gray-500'>No balance</p>
            ) : (
              <ul className='space-y-1 text-sm'>
                {Object.entries(balances).map(([assetId, amount]) => (
                  <li key={assetId}>
                    <code className='break-all'>{assetId}</code>: {amount}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {env.VITE_DEBUG_MNEMONIC && xOnlyPubKey && (
            <div className='space-y-1'>
              <p className='text-sm font-medium'>X-Only Public Key (Simplicity)</p>
              <code className='break-all text-xs'>{xOnlyPubKey.toString()}</code>
            </div>
          )}

          <div className='space-y-2 rounded border border-gray-200 p-4'>
            <p className='text-sm font-medium'>Send Transfer</p>
            <input
              className='w-full rounded border border-gray-300 px-3 py-2 text-sm'
              placeholder='Recipient address'
              value={sendAddress}
              onChange={e => setSendAddress(e.target.value)}
            />
            <input
              className='w-full rounded border border-gray-300 px-3 py-2 text-sm'
              placeholder='Amount (satoshis)'
              type='number'
              min='1'
              value={sendAmount}
              onChange={e => setSendAmount(e.target.value)}
            />
          </div>
        </div>
      )}

      {isError && error && <p className='text-sm text-red-500'>{error}</p>}

      <p>
        Network: <code>{network}</code>
      </p>
      <p>
        isTestnet: {isTestnet.toString()} / isMainnet: {isMainnet.toString()} / isRegtest:{' '}
        {isRegtest.toString()}
      </p>
    </div>
  )
}
