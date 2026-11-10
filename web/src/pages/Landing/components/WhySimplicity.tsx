import BookOpenIcon from '@/components/icons/BookOpenIcon'
import CalculatorIcon from '@/components/icons/CalculatorIcon'
import EyeIcon from '@/components/icons/EyeIcon'
import ShieldIcon from '@/components/icons/ShieldIcon'

import { LandingContainer } from './LandingContainer'
import { Reveal } from './Reveal'

const FEATURES = [
  {
    icon: ShieldIcon,
    title: 'Trustless',
    description: 'Only the contract holds the collateral.',
  },
  {
    icon: CalculatorIcon,
    title: 'Math Is Law',
    description:
      "Every contract is mathematically provable. If the math doesn't check out, the transaction doesn't send.",
  },
  {
    icon: EyeIcon,
    title: 'Fully Transparent',
    description: 'Every loan is visible on-chain.',
  },
  {
    icon: BookOpenIcon,
    title: 'Open-Source',
    description: 'Read the code and verify the logic yourself.',
  },
]

export function WhySimplicity() {
  return (
    <LandingContainer className='flex flex-col gap-10 py-12 lg:py-20' as='section'>
      <Reveal className='flex flex-col gap-4'>
        <p className='text-accent text-xs font-bold'>WHY SIMPLICITY</p>
        <p className='text-h2'>Trust the Math Instead.</p>
        <p className='text-foreground text-sm'>
          Your bitcoin is locked in a Simplicity smart contract on the Liquid Network. The contract
          governs collateral, repayment, and liquidation. No human can override it.
        </p>
      </Reveal>
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
        {FEATURES.map(({ icon: Icon, title, description }, index) => (
          <Reveal
            key={title}
            delay={index * 0.08}
            className='bg-surface-secondary flex flex-col gap-3 rounded-3xl p-6'
          >
            <Icon className='text-foreground size-6' />
            <div className='flex flex-col gap-1.5'>
              <p className='text-foreground text-xl font-semibold'>{title}</p>
              <p className='text-muted text-sm'>{description}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </LandingContainer>
  )
}
