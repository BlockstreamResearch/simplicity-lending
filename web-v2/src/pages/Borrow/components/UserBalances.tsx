import { NETWORK_CONFIG } from '@/constants/network-config'
import { useWallet } from '@/providers/wallet/useWallet'

import BalanceCard from './BalanceCard'

export default function UserBalances() {
  const { balances } = useWallet()
  const { collateralAsset, principalAsset } = NETWORK_CONFIG

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
            className='sm:w-65.5'
          />
        ))}
      </div>
    </section>
  )
}
