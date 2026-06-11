import Notification from '@/components/Notification'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useNotifications } from '@/providers/notifications/NotificationsContext'
import { useWallet } from '@/providers/wallet/useWallet'

import BalanceCard from './BalanceCard'

export default function UserBalances() {
  const { balances } = useWallet()
  const { notifications, dismiss } = useNotifications()
  const { collateralAsset, principalAsset } = NETWORK_CONFIG

  const notification = notifications.at(-1)

  return (
    <section className='flex flex-col gap-2'>
      <h2 className='text-muted text-[11px] font-semibold tracking-wide uppercase'>
        User Balances
      </h2>
      <div className='flex flex-col gap-4 sm:flex-row sm:items-stretch sm:gap-6'>
        {[collateralAsset, principalAsset].map(asset => (
          <BalanceCard
            key={asset.id}
            asset={asset}
            amount={BigInt(balances[asset.id] ?? 0)}
            className='bg-surface shadow-surface sm:w-65.5'
          />
        ))}
        {notification && (
          <div className='flex flex-1 items-center'>
            <Notification
              variant={notification.variant}
              title={notification.title}
              description={notification.description}
              action={notification.action}
              onDismiss={() => dismiss(notification.id)}
            />
          </div>
        )}
      </div>
    </section>
  )
}
