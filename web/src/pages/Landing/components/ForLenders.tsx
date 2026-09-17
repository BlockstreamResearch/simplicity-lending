import FileCheckIcon from '@/components/icons/FileCheckIcon'
import ListChecksIcon from '@/components/icons/ListChecksIcon'
import LockIcon from '@/components/icons/LockIcon'

import { LandingContainer } from './LandingContainer'
import { LiveOffersPreview } from './LiveOffersPreview'
import { Reveal } from './Reveal'

const CARDS = [
  {
    icon: FileCheckIcon,
    title: 'Transparent Rate Discovery',
    description: 'See what the market is pricing before you commit.',
  },
  {
    icon: LockIcon,
    title: 'Collateral-Secured',
    description: 'Every loan is backed by locked LBTC on the Liquid Network.',
  },
  {
    icon: ListChecksIcon,
    title: 'Borrower-Set Terms',
    description: 'Review the duration and rate each borrower offers before you commit capital.',
  },
]

export function ForLenders() {
  return (
    <LandingContainer className='flex flex-col items-center gap-10 py-12 lg:py-20' as='section'>
      <Reveal className='hidden lg:block'>
        <LiveOffersPreview />
      </Reveal>
      <div className='flex flex-col items-center gap-10'>
        <Reveal className='flex max-w-200 flex-col items-center gap-4 text-center'>
          <div className='flex flex-col gap-4'>
            <p className='text-accent text-xs font-bold'>FOR LENDERS</p>
            <p className='text-h2'>Earn by Funding Loans</p>
          </div>
          <p className='text-foreground text-sm'>
            Lend your USDT liquidity and earn interest. Review borrower requests and the rates
            they&apos;ve set, then fund loans directly. Every loan is backed by locked LBTC on the
            Liquid Network. If a borrower doesn&apos;t repay, the contract allows you to take
            possession of the collateral.
          </p>
        </Reveal>
        <div className='grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3'>
          {CARDS.map(({ icon: Icon, title, description }, index) => (
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
      </div>
    </LandingContainer>
  )
}
