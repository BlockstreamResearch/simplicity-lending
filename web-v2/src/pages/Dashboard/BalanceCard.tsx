import type { ReactNode } from 'react'

import { WalletButton } from '@/components/WalletButton'

import { CardError, CardHeader, CardShell } from './BaseCard'

export function BalanceCard({
  icon,
  title,
  subtitle,
  isLoading,
  isReady,
  error,
  connectMessage,
  errorMessage,
  onRetry,
  balance,
  fiat,
  children,
}: {
  icon: ReactNode
  title: string
  subtitle: string
  isLoading: boolean
  isReady: boolean
  error: Error | null
  connectMessage: string
  errorMessage: string
  onRetry: () => void
  balance: ReactNode
  fiat?: string
  children: ReactNode
}) {
  const showBody = isReady && !error
  return (
    <CardShell>
      <CardHeader
        icon={icon}
        title={title}
        subtitle={subtitle}
        isLoading={isLoading}
        balance={showBody ? balance : '—'}
        fiat={showBody ? fiat : undefined}
      />
      {!isReady ? (
        <div className='bg-surface flex flex-col items-start gap-4 rounded-lg p-4 sm:p-6'>
          <p className='text-muted text-sm'>{connectMessage}</p>
          <WalletButton />
        </div>
      ) : error ? (
        <CardError message={error.message || errorMessage} onRetry={onRetry} />
      ) : (
        children
      )}
    </CardShell>
  )
}
