import type { ComponentType, SVGProps } from 'react'

import CircleCheckIcon from '@/components/icons/CircleCheckIcon'
import CircleMinusIcon from '@/components/icons/CircleMinusIcon'
import CircleXIcon from '@/components/icons/CircleXIcon'

import { LandingContainer } from './LandingContainer'
import { Reveal } from './Reveal'

type Verdict = 'yes' | 'no' | 'neutral'

const VERDICT_ICON: Record<Verdict, ComponentType<SVGProps<SVGSVGElement>>> = {
  yes: CircleCheckIcon,
  no: CircleXIcon,
  neutral: CircleMinusIcon,
}

const VERDICT_COLOR: Record<Verdict, string> = {
  yes: 'text-success',
  no: 'text-danger',
  neutral: 'text-muted',
}

const ROWS: {
  label: string
  simplicity: { verdict: Verdict; text: string }
  cefi: { verdict: Verdict; text: string }
}[] = [
  {
    label: 'Counterparty & custody',
    simplicity: { verdict: 'yes', text: 'The smart contract holds collateral, visible on-chain' },
    cefi: { verdict: 'no', text: 'A company holds funds; trust its proof-of-reserves' },
  },
  {
    label: 'Execution safety',
    simplicity: {
      verdict: 'yes',
      text: 'Deterministic execution — no reentrancy or flash-loan attack surface by design',
    },
    cefi: { verdict: 'neutral', text: 'Off-chain ledger, not contract-executed' },
  },
  {
    label: 'Rates & terms',
    simplicity: { verdict: 'yes', text: 'Borrower-set terms; transparent rate discovery' },
    cefi: { verdict: 'no', text: 'Rates are set by the platform' },
  },
]

function Cell({
  verdict,
  text,
  emphasis = false,
  className = '',
}: {
  verdict: Verdict
  text: string
  emphasis?: boolean
  className?: string
}) {
  const Icon = VERDICT_ICON[verdict]
  return (
    <td className={`align-top p-5 ${emphasis ? 'bg-[#f3f1fc]' : ''} ${className}`}>
      <div className='flex items-start gap-2.5'>
        <Icon className={`size-6 shrink-0 ${VERDICT_COLOR[verdict]}`} />
        <p className={`text-sm ${emphasis ? 'text-foreground' : 'text-muted'}`}>{text}</p>
      </div>
    </td>
  )
}

function VerdictRow({
  verdict,
  text,
  emphasis = false,
}: {
  verdict: Verdict
  text: string
  emphasis?: boolean
}) {
  const Icon = VERDICT_ICON[verdict]
  return (
    <div className='flex items-start gap-2.5'>
      <Icon className={`size-5 shrink-0 ${VERDICT_COLOR[verdict]}`} />
      <p className={`text-sm ${emphasis ? 'text-foreground' : 'text-muted'}`}>{text}</p>
    </div>
  )
}

// Below `lg` a 3-column table just gets squeezed into unreadable horizontal
// scroll, so each row becomes its own stacked card instead — the Simplicity
// side is still visually promoted with the same lavender tint.
function ComparisonCards() {
  return (
    <div className='flex w-full flex-col gap-4 lg:hidden'>
      {ROWS.map(row => (
        <div
          key={row.label}
          className='border-border flex flex-col gap-4 rounded-2xl border bg-surface p-4'
        >
          <p className='text-foreground text-sm font-bold'>{row.label}</p>
          <div className='flex flex-col gap-2 rounded-xl bg-[#f3f1fc] p-3'>
            <span className='text-accent text-xs font-bold'>Simplicity Bitcoin Lending</span>
            <VerdictRow {...row.simplicity} emphasis />
          </div>
          <div className='flex flex-col gap-2'>
            <span className='text-muted text-xs font-bold'>CeFi lending</span>
            <VerdictRow {...row.cefi} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function ComparisonTable() {
  return (
    <LandingContainer className='flex flex-col items-center gap-10 py-12 lg:py-20' as='section'>
      <Reveal>
        <p className='text-h2 text-center'>Why Simplicity Bitcoin Lending Is Different</p>
      </Reveal>
      <Reveal delay={0.1} className='w-full'>
        <ComparisonCards />
        <div className='hidden w-full overflow-x-auto rounded-3xl border border-[#ebebec] shadow-[0px_2px_8px_0px_rgba(0,0,0,0.06),0px_-6px_12px_0px_rgba(0,0,0,0.03),0px_14px_28px_0px_rgba(0,0,0,0.08)] lg:block'>
          <table className='w-full min-w-140 border-collapse'>
            <thead>
              <tr>
                <th className='text-muted p-5 text-left text-xs font-bold'>Compared on</th>
                <th className='bg-accent text-accent-foreground p-5 text-left'>
                  <p className='text-[15px] font-bold'>Simplicity Bitcoin Lending</p>
                  <p className='text-xs font-normal opacity-85'>Bitcoin-native, on Liquid</p>
                </th>
                <th className='border-l border-[#ebebec] p-5 text-left'>
                  <p className='text-foreground text-[15px] font-bold'>CeFi lending</p>
                  <p className='text-muted text-xs font-normal'>Ledn · Nexo · Unchained</p>
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(row => (
                <tr key={row.label} className='border-t border-[#ebebec]'>
                  <td className='p-5 align-top'>
                    <p className='text-foreground text-sm font-bold'>{row.label}</p>
                  </td>
                  <Cell {...row.simplicity} emphasis />
                  <Cell {...row.cefi} className='border-l border-[#ebebec]' />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>
    </LandingContainer>
  )
}
