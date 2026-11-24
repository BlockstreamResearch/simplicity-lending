import { Chip } from '@heroui/react'
import type { ReactNode } from 'react'

import type { ParticipantType } from '@/api/indexer/schemas'
import borrowerAvatarUrl from '@/assets/avatars/borrower.png'
import lenderAvatarUrl from '@/assets/avatars/lender.png'
import CopyButton from '@/components/CopyButton'
import { scriptPubkeyToAddress } from '@/utils/format'

import OfferMetric from './OfferMetric'

const PARTICIPANT_AVATAR_CONFIG: Record<ParticipantType, string> = {
  borrower: borrowerAvatarUrl,
  lender: lenderAvatarUrl,
}

interface ParticipantCardProps {
  participant: ParticipantType
  title: string
  subtitle: string
  scriptPubkey?: string
  amountLabel: string
  amountTooltip?: string
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
  amountTooltip,
  amount,
  caption,
  isYou,
  isPlaceholder,
}: ParticipantCardProps) {
  const address = isPlaceholder ? undefined : scriptPubkey

  return (
    <div
      className={`flex min-w-0 flex-1 flex-col gap-3 rounded-sm p-4 sm:p-6 ${
        isPlaceholder ? '' : 'bg-surface'
      }`}
    >
      <div className='flex items-center justify-between gap-2'>
        <div className='flex min-w-0 items-center gap-2'>
          {address ? (
            <img
              src={PARTICIPANT_AVATAR_CONFIG[participant]}
              alt=''
              aria-hidden='true'
              className='size-9 shrink-0 rounded-full object-cover'
            />
          ) : (
            <span
              aria-hidden='true'
              className='border-muted size-9 shrink-0 rounded-full border border-dashed'
            />
          )}
          <div className='flex min-w-0 flex-col'>
            <span className={`text-h4 ${isPlaceholder ? 'text-muted' : 'text-foreground'}`}>
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
          <Chip variant='soft' size='lg' color={participant === 'borrower' ? 'accent' : 'success'}>
            You
          </Chip>
        )}
      </div>
      <OfferMetric
        label={amountLabel}
        tooltip={amountTooltip}
        value={isPlaceholder ? <span className='text-muted'>{amount}</span> : amount}
        caption={caption}
      />
    </div>
  )
}
