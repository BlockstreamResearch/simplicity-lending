import { Skeleton } from '@heroui/react'
import type { ReactNode } from 'react'

import LbtcIcon from '@/components/icons/LbtcIcon'
import UsdtIcon from '@/components/icons/UsdtIcon'
import { UiButton } from '@/components/ui/UiButton'

export function CardShell({ children }: { children: ReactNode }) {
  return (
    <section className='bg-surface-secondary flex flex-1 flex-col gap-4 rounded-2xl p-4 sm:p-6'>
      {children}
    </section>
  )
}

const UNIT_LOGO: Record<string, ReactNode> = {
  LBTC: <LbtcIcon className='size-4' />,
  USDT: <UsdtIcon className='size-4' />,
}

export function AssetAmount({ value, unit }: { value: string; unit: string }) {
  return (
    <>
      {value}
      <span className='text-muted ml-1.5 inline-flex items-center gap-1 text-sm font-medium'>
        {UNIT_LOGO[unit]}
        {unit}
      </span>
    </>
  )
}

export function CardHeader({
  icon,
  title,
  subtitle,
  balance,
  fiat,
  isLoading,
}: {
  icon: ReactNode
  title: string
  subtitle: string
  balance: ReactNode
  fiat?: string
  isLoading?: boolean
}) {
  return (
    <header className='flex flex-col gap-2'>
      <div className='flex items-center gap-2'>
        <span className='text-foreground'>{icon}</span>
        <h3 className='text-h3'>{title}</h3>
      </div>
      <p className='text-muted text-h4'>{subtitle}</p>
      {isLoading ? (
        <Skeleton className='mt-1 h-8 w-32 rounded-lg' />
      ) : (
        <p className='text-display mt-1'>{balance}</p>
      )}
      {!isLoading && fiat && <p className='text-muted text-xs'>{fiat}</p>}
    </header>
  )
}

export function CardAlert({
  variant,
  title,
  description,
  actionLabel,
  onAction,
  isDisabled,
}: {
  variant: 'warning' | 'accent'
  title: string
  description: string
  actionLabel: string
  onAction?: () => void
  isDisabled?: boolean
}) {
  const titleColor = variant === 'warning' ? 'text-warning' : 'text-foreground'
  return (
    <div className='bg-surface shadow-field flex items-center justify-between gap-4 rounded-lg p-4'>
      <div>
        <p className={`text-sm font-medium ${titleColor}`}>{title}</p>
        <p className='text-muted mt-1 text-sm'>{description}</p>
      </div>
      <UiButton
        size='sm'
        variant='primary'
        className='shrink-0'
        onPress={onAction}
        isDisabled={isDisabled}
      >
        {actionLabel}
      </UiButton>
    </div>
  )
}

export function CardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className='bg-surface flex flex-col gap-3 rounded-lg p-4 sm:p-6'>
      <p className='text-danger text-sm'>{message}</p>
      <UiButton className='self-start' variant='secondary' onPress={onRetry}>
        Retry
      </UiButton>
    </div>
  )
}
