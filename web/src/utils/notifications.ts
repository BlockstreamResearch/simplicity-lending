import type { OfferShort } from '@/api/indexer/schemas'
import { REPAYMENT_DUE_THRESHOLD_BLOCKS } from '@/constants/offers'

import { truncateAddress } from './format'
import { type OfferAction, resolveOfferAction } from './offerActions'
import { getOfferTermLeft } from './offers'

type OfferActionKey = Exclude<OfferAction, 'accept' | 'none'>

export interface OfferNotification {
  offer: OfferShort
  kind: OfferActionKey
  variant: 'accent' | 'warning' | 'danger'
  title: string
  description: string
  actionLabel: string
}

interface NotificationMeta {
  variant: 'accent' | 'warning'
  title: string
  actionLabel: string
  priority: number
  describe: (id: string) => string
}

const NOTIFICATION_META: Record<OfferActionKey, NotificationMeta> = {
  liquidate: {
    variant: 'warning',
    title: 'Collateral Liquidatable',
    actionLabel: 'Liquidate',
    priority: 0,
    describe: id => `Loan #${id} has expired. You can now claim the collateral.`,
  },
  'claim-interest': {
    variant: 'accent',
    title: 'Repayment Available',
    actionLabel: 'Claim Now',
    priority: 1,
    describe: id => `Loan #${id} has been repaid. You can now claim the repayment.`,
  },
  'claim-principal': {
    variant: 'accent',
    title: 'Principal Available',
    actionLabel: 'Claim Now',
    priority: 0,
    describe: id => `Loan #${id} is funded. You can now claim your principal.`,
  },
  cancel: {
    variant: 'warning',
    title: 'Offer Expired',
    actionLabel: 'Cancel',
    priority: 1,
    describe: id => `Offer #${id} has expired. Cancel it to reclaim your collateral.`,
  },
  repay: {
    variant: 'warning',
    title: 'Repayment Due Soon',
    actionLabel: 'Repay Now',
    priority: 2,
    describe: id => `Loan #${id} nearing deadline. Repay to avoid liquidation.`,
  },
}

function shouldNotify(
  action: OfferActionKey,
  offer: OfferShort,
  currentBlockHeight: number | undefined,
): boolean {
  switch (action) {
    case 'claim-interest':
    case 'claim-principal':
    case 'liquidate':
      return true
    case 'cancel':
      return currentBlockHeight !== undefined && currentBlockHeight > offer.loan_expiration_height
    case 'repay': {
      if (currentBlockHeight === undefined) return false
      const termLeft = getOfferTermLeft(offer, currentBlockHeight)
      return termLeft < REPAYMENT_DUE_THRESHOLD_BLOCKS
    }
  }
}

function toNotification(
  offer: OfferShort,
  action: OfferActionKey,
  currentBlockHeight: number | undefined,
): OfferNotification {
  const meta = NOTIFICATION_META[action]
  const isOverdue =
    action === 'repay' &&
    currentBlockHeight !== undefined &&
    currentBlockHeight > offer.loan_expiration_height

  return {
    offer,
    kind: action,
    variant: isOverdue ? 'danger' : meta.variant,
    title: isOverdue ? 'Repayment Overdue' : meta.title,
    description: isOverdue
      ? `Loan #${truncateAddress(offer.id)} has expired, but you can still repay and reclaim your collateral before the lender liquidates it.`
      : meta.describe(truncateAddress(offer.id)),
    actionLabel: meta.actionLabel,
  }
}

export function buildOfferNotifications(
  offers: OfferShort[],
  scriptPubkey: string | null,
  currentBlockHeight: number | undefined,
): OfferNotification[] {
  const list: OfferNotification[] = []
  for (const offer of offers) {
    const action = resolveOfferAction(offer, scriptPubkey, currentBlockHeight ?? 0)
    if (action === 'accept' || action === 'none') continue
    if (shouldNotify(action, offer, currentBlockHeight)) {
      list.push(toNotification(offer, action, currentBlockHeight))
    }
  }
  return list.sort(
    (a, b) => NOTIFICATION_META[a.kind].priority - NOTIFICATION_META[b.kind].priority,
  )
}
