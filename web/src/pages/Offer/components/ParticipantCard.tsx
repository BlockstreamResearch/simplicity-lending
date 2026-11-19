import { Chip } from '@heroui/react'
import type { ReactNode } from 'react'

import type { ParticipantType } from '@/api/indexer/schemas'
import CopyButton from '@/components/CopyButton'
import { scriptPubkeyToAddress } from '@/utils/format'

const PARTICIPANT_AVATAR_HUE: Record<ParticipantType, number> = { borrower: 255, lender: 145 }
const AVATAR_HUE_SPREAD = 30
const HASH_MULTIPLIER = 31

function addressGradient(seed: string, participant: ParticipantType): string {
  let hash = 0
  for (const char of seed) hash = (hash * HASH_MULTIPLIER + char.charCodeAt(0)) | 0
  const hue =
    PARTICIPANT_AVATAR_HUE[participant] +
    (Math.abs(hash) % AVATAR_HUE_SPREAD) -
    AVATAR_HUE_SPREAD / 2
  return `radial-gradient(circle at 30% 30%, hsl(${hue - 50} 85% 88%), hsl(${hue} 80% 65%) 55%, hsl(${hue + 15} 70% 45%))`
}

interface ParticipantCardProps {
  participant: ParticipantType
  title: string
  subtitle: string
  scriptPubkey?: string
  amountLabel: string
  amount: ReactNode
  caption?: string
  isYou?: boolean
  isPlaceholder?: boolean
}

export default function ParticipantCard({
  participant,
  title,
  subtitle,
  scriptPubkey,
  amountLabel,
  amount,
  caption,
  isYou,
  isPlaceholder,
}: ParticipantCardProps) {
  const address = isPlaceholder ? undefined : scriptPubkey

  return (
    <div
      className={`flex min-w-0 flex-1 flex-col gap-2 rounded-2xl p-4 ${
        isPlaceholder ? '' : 'bg-surface'
      }`}
    >
      <div className='flex items-start justify-between gap-2'>
        <div className='flex min-w-0 items-center gap-2.5'>
          {address ? (
            <span
              aria-hidden='true'
              className='size-8 shrink-0 rounded-full'
              style={{ background: addressGradient(address, participant) }}
            />
          ) : (
            <span
              aria-hidden='true'
              className='border-muted size-8 shrink-0 rounded-full border border-dashed'
            />
          )}
          <div className='flex min-w-0 flex-col'>
            <span className={`font-medium ${isPlaceholder ? 'text-muted' : 'text-foreground'}`}>
              {title}
            </span>
            <span className='text-muted flex min-w-0 items-center gap-1 text-xs'>
              <span className='truncate'>{subtitle}</span>
              {address && (
                <CopyButton
                  value={scriptPubkeyToAddress(address)}
                  aria-label='Copy address'
                  className='size-5 min-w-5'
                />
              )}
            </span>
          </div>
        </div>
        {isYou && (
          <Chip variant='soft' size='sm' color={participant === 'borrower' ? 'accent' : 'success'}>
            You
          </Chip>
        )}
      </div>
      <span className='text-muted text-sm'>{amountLabel}</span>
      <p className={`text-xl font-semibold break-all ${isPlaceholder ? 'text-muted' : ''}`}>
        {amount}
      </p>
      {caption && <span className='text-muted text-xs'>{caption}</span>}
    </div>
  )
}
