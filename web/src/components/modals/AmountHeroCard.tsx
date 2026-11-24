import type { ConfigAsset } from '@/constants/network-config'

interface AmountHeroCardProps {
  label: string
  icon: ConfigAsset['icon']
  value: string
  unit: string
}

export default function AmountHeroCard({ label, icon: Icon, value, unit }: AmountHeroCardProps) {
  return (
    <section className='bg-surface-secondary flex flex-col gap-3 rounded-xl p-6'>
      <span className='text-h4 text-muted'>{label}</span>
      <p className='flex items-center gap-2'>
        <Icon className='size-6 shrink-0' />
        <span className='text-display break-all'>{value}</span>
        <span className='text-muted self-end pb-0.5 text-sm font-medium'>{unit}</span>
      </p>
    </section>
  )
}
