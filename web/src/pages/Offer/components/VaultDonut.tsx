import { NETWORK_CONFIG } from '@/constants/network-config'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import { formatAmountShort } from '@/utils/format'

const RING_SIZE = 156
const RING_STROKE = 21
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const MIN_ARC_PERCENT = 2
const ARC_GAP_PERCENT = 0.5

const DONUT_TONE_CONFIG = {
  success: { stroke: 'stroke-success', dot: 'bg-success' },
  'success-soft': {
    stroke: 'stroke-success-soft',
    dot: 'bg-success-soft border border-success/40',
  },
  accent: { stroke: 'stroke-accent', dot: 'bg-accent' },
  default: { stroke: 'stroke-default', dot: 'bg-default border border-muted/30' },
}

interface VaultDonutSegment {
  label: string
  amount: bigint
  tone: keyof typeof DONUT_TONE_CONFIG
  isRoundedUp?: boolean
}

interface VaultDonutProps {
  segments: VaultDonutSegment[]
  centerIndex: number
}

export default function VaultDonut({ segments, centerIndex }: VaultDonutProps) {
  const { formatPrincipalAmount, formatPrincipalShort } = useFormatAmount()
  const { principalAsset } = NETWORK_CONFIG
  const PrincipalIcon = principalAsset.icon
  const center = segments[centerIndex]

  const total = segments.reduce((sum, segment) => sum + segment.amount, 0n)
  const arcs = segments.map(segment =>
    total > 0n && segment.amount > 0n
      ? Math.max((Number(segment.amount) / Number(total)) * 100, MIN_ARC_PERCENT)
      : 0,
  )
  if (total > 0n) {
    arcs[arcs.indexOf(Math.max(...arcs))] -= arcs.reduce((sum, arc) => sum + arc, 0) - 100
  }
  const offsets = arcs.map((_, index) => arcs.slice(0, index).reduce((sum, arc) => sum + arc, 0))
  const gap = arcs.filter(arc => arc > 0).length > 1 ? ARC_GAP_PERCENT : 0

  return (
    <div className='@container'>
      <div className='flex flex-col items-center gap-4 @min-[308px]:flex-row @min-[308px]:gap-6'>
        <div aria-hidden className='relative size-39 shrink-0'>
          <svg viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} className='size-full -rotate-90'>
            {total === 0n && (
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill='none'
                strokeWidth={RING_STROKE}
                className='stroke-default'
              />
            )}
            {segments.map(
              (segment, index) =>
                arcs[index] > 0 && (
                  <circle
                    key={segment.label}
                    cx={RING_SIZE / 2}
                    cy={RING_SIZE / 2}
                    r={RING_RADIUS}
                    fill='none'
                    strokeWidth={RING_STROKE}
                    pathLength={100}
                    strokeDasharray={`${arcs[index] - gap} ${100 - arcs[index] + gap}`}
                    strokeDashoffset={-offsets[index] - gap / 2}
                    className={DONUT_TONE_CONFIG[segment.tone].stroke}
                  />
                ),
            )}
          </svg>
          <div className='bg-surface absolute inset-5.25 flex flex-col items-center justify-center rounded-full'>
            <span className='flex items-center gap-1 text-lg font-bold whitespace-nowrap'>
              {formatAmountShort(center.amount, principalAsset.decimals, center.isRoundedUp)}
              <PrincipalIcon className='size-4 shrink-0' />
            </span>
            <span className='text-muted text-xs font-medium whitespace-nowrap'>{center.label}</span>
          </div>
        </div>
        <ul className='flex w-full flex-col gap-2 @min-[308px]:gap-3'>
          {segments.map(segment => (
            <li
              key={segment.label}
              className='flex items-center justify-between gap-3 @min-[308px]:flex-col @min-[308px]:items-start @min-[308px]:gap-0'
            >
              <span className='text-muted flex items-center gap-2 text-xs whitespace-nowrap'>
                <span
                  className={`size-4 shrink-0 rounded-full ${DONUT_TONE_CONFIG[segment.tone].dot}`}
                />
                {segment.label}
              </span>
              <span
                className='text-sm font-medium whitespace-nowrap @min-[308px]:pl-6'
                title={formatPrincipalAmount(segment.amount)}
              >
                {formatPrincipalShort(segment.amount, segment.isRoundedUp)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
