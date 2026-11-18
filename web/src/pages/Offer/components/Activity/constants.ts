import type { ComponentType, SVGProps } from 'react'

import type { ParticipantType } from '@/api/indexer/schemas'
import ArrowUpFromBracketIcon from '@/components/icons/ArrowUpFromBracketIcon'
import CheckBoldIcon from '@/components/icons/CheckBoldIcon'
import HandArrowDownIcon from '@/components/icons/HandArrowDownIcon'
import PlusBoldIcon from '@/components/icons/PlusBoldIcon'
import TrashBinIcon from '@/components/icons/TrashBinIcon'
import TrayArrowDownIcon from '@/components/icons/TrayArrowDownIcon'
import TriangleExclamationIcon from '@/components/icons/TriangleExclamationIcon'

import type { OfferActivityType } from './helpers'

export const ACTOR_LABEL: Record<ParticipantType, string> = {
  borrower: 'Borrower',
  lender: 'Lender',
}

interface ActivityEventConfig {
  title: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
  tone: string
}

const ACCENT_TONE = 'bg-accent-soft text-accent-soft-foreground'
const SUCCESS_TONE = 'bg-success-soft text-success-soft-foreground'
const DANGER_TONE = 'bg-danger-soft text-danger-soft-foreground'

export const ACTIVITY_EVENT_CONFIG: Record<OfferActivityType, ActivityEventConfig> = {
  created: { title: 'Created', Icon: PlusBoldIcon, tone: ACCENT_TONE },
  accepted: { title: 'Accepted', Icon: CheckBoldIcon, tone: SUCCESS_TONE },
  'principal-claimed': { title: 'Principal Claimed', Icon: HandArrowDownIcon, tone: ACCENT_TONE },
  'partial-repayment': { title: 'Partial Repayment', Icon: TrayArrowDownIcon, tone: ACCENT_TONE },
  'full-repayment': { title: 'Full Repayment', Icon: TrayArrowDownIcon, tone: ACCENT_TONE },
  'partial-withdrawal': {
    title: 'Partial Withdrawal',
    Icon: ArrowUpFromBracketIcon,
    tone: SUCCESS_TONE,
  },
  'full-withdrawal': { title: 'Full Withdrawal', Icon: ArrowUpFromBracketIcon, tone: SUCCESS_TONE },
  cancelled: { title: 'Cancelled', Icon: TrashBinIcon, tone: DANGER_TONE },
  liquidated: { title: 'Liquidated', Icon: TriangleExclamationIcon, tone: DANGER_TONE },
}
