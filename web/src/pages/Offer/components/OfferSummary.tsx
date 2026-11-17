import type { ReactNode } from 'react'

import type { OfferDetails, OfferStatus } from '@/api/indexer/schemas'
import { useAssetPriceUsd } from '@/api/prices/hooks'
import { AssetAmount } from '@/components/AssetAmount'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useBlockDate } from '@/hooks/useBlockDate'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import {
  formatAmount,
  formatScriptPubkeyAsAddress,
  formatShortDate,
  formatUsd,
} from '@/utils/format'
import type { ActorRole } from '@/utils/offerActions'
import { calcInterest, computeApr, computeAprAfterFees } from '@/utils/offers'

import {
  formatLoanTerm,
  getLenderNetInterest,
  getLenderPayout,
  getLiquidatedCollateral,
  getLoanDurationBlocks,
  getRepaidToLender,
  getReturnedCollateral,
  getUtxoCreatedHeight,
} from '../helpers'
import ParticipantCard from './ParticipantCard'

const COLLATERAL_LABEL_BY_STATUS: Record<OfferStatus, string> = {
  pending: 'Locked as Collateral',
  active: 'Collateral Still Locked',
  repaid: 'Collateral Returned',
  claimed: 'Collateral Returned',
  cancelled: 'Collateral Returned',
  liquidated: 'Collateral Went to the Lender',
}

interface StatProps {
  label: string
  value: ReactNode
}

function Stat({ label, value }: StatProps) {
  return (
    <div className='flex min-w-0 flex-col gap-2'>
      <span className='text-muted text-sm'>{label}</span>
      <p className='text-xl font-semibold break-all'>{value}</p>
    </div>
  )
}

interface OfferSummaryProps {
  offer: OfferDetails
  role: ActorRole
}

export default function OfferSummary({ offer, role }: OfferSummaryProps) {
  const { collateralUnit, formatCollateralAmount, formatCollateralDisplay, formatPrincipalAmount } =
    useFormatAmount()
  const { collateralAsset, principalAsset } = NETWORK_CONFIG
  const collateralPriceUsd = useAssetPriceUsd(collateralAsset.id)
  const acceptedAt = useBlockDate(getUtxoCreatedHeight(offer, 'active_offer') ?? 0)

  const borrower = offer.participants.find(p => p.participant_type === 'borrower')
  const lender = offer.participants.find(p => p.participant_type === 'lender')
  const loanDurationBlocks = getLoanDurationBlocks(offer)
  const loanTerm = formatLoanTerm(loanDurationBlocks)
  const lenderPayout = getLenderPayout(offer)
  const lenderNetInterest = getLenderNetInterest(offer)
  const returnedCollateral = getReturnedCollateral(offer)

  const formatPrincipal = (amount: bigint) => formatAmount(amount, principalAsset.decimals)
  const renderPrincipal = (amount: bigint, total?: bigint) => (
    <AssetAmount
      value={formatPrincipal(amount)}
      unit={principalAsset.symbol}
      total={total === undefined ? undefined : formatPrincipal(total)}
    />
  )

  const shownCollateral =
    offer.status === 'active'
      ? offer.collateral_remaining
      : offer.status === 'liquidated'
        ? getLiquidatedCollateral(offer)
        : offer.collateral_amount
  const shownCollateralUsd = formatUsd(
    shownCollateral,
    collateralAsset.decimals,
    collateralPriceUsd,
  )
  const borrowerCaption = [
    shownCollateralUsd && `≈ ${shownCollateralUsd} at today's price`,
    offer.status === 'active' &&
      returnedCollateral > 0n &&
      `${formatCollateralDisplay(returnedCollateral)} already returned`,
  ]
    .filter(Boolean)
    .join(' · ')

  const lenderSentCaption = `Lent ${formatPrincipalAmount(offer.principal_amount)}${
    acceptedAt ? ` on ${formatShortDate(acceptedAt)}` : ''
  }`

  const lenderCard = (() => {
    switch (offer.status) {
      case 'pending':
        return {
          subtitle: 'Open - nobody yet',
          isPlaceholder: true,
          amountLabel: 'Needed to Fund It',
          amount: renderPrincipal(offer.principal_amount),
          caption: 'Anyone with a connected wallet can accept',
        }
      case 'cancelled':
        return {
          subtitle: 'None',
          isPlaceholder: true,
          amountLabel: 'Was Asking For',
          amount: renderPrincipal(offer.principal_amount),
          caption: 'Cancelled before anyone accepted',
        }
      case 'active':
        return {
          amountLabel: 'Received So Far',
          amount: renderPrincipal(getRepaidToLender(offer), lenderPayout),
          caption: offer.borrower_principal_utxo
            ? 'Funded, not yet claimed by the borrower'
            : lenderSentCaption,
        }
      case 'repaid':
      case 'claimed':
        return {
          amountLabel: 'Received',
          amount: renderPrincipal(lenderPayout),
          caption: lenderSentCaption,
        }
      case 'liquidated':
        return {
          amountLabel: 'Repaid',
          amount: renderPrincipal(getRepaidToLender(offer), lenderPayout),
          caption: `Took the ${formatCollateralDisplay(shownCollateral)} collateral instead`,
        }
    }
  })()

  const isBorrowerView = role === 'borrower'
  const earningsStat: StatProps = (() => {
    if (offer.status === 'cancelled') {
      return { label: 'Asked For', value: renderPrincipal(offer.principal_amount) }
    }
    if (isBorrowerView) {
      return {
        label: 'The Loan Costs You',
        value: renderPrincipal(calcInterest(offer.principal_amount, offer.interest_rate)),
      }
    }
    if (offer.status === 'liquidated') {
      return {
        label: 'No Longer Claimable',
        value: renderPrincipal(lenderNetInterest),
      }
    }
    return {
      label:
        offer.status === 'repaid' || offer.status === 'claimed'
          ? 'Total Earnings'
          : 'Expected Earnings',
      value: renderPrincipal(lenderNetInterest),
    }
  })()
  const apr = isBorrowerView
    ? computeApr(offer.interest_rate, loanDurationBlocks)
    : computeAprAfterFees(offer.interest_rate, loanDurationBlocks)

  return (
    <section className='bg-surface-secondary flex min-w-0 flex-col gap-4 rounded-3xl p-4 sm:p-6 lg:col-span-2'>
      <div className='flex flex-col gap-4 sm:flex-row'>
        <ParticipantCard
          title='Borrower'
          subtitle={formatScriptPubkeyAsAddress(borrower?.script_pubkey ?? '')}
          isYou={role === 'borrower'}
          amountLabel={COLLATERAL_LABEL_BY_STATUS[offer.status]}
          amount={
            <AssetAmount
              value={formatCollateralAmount(shownCollateral)}
              unit={collateralUnit}
              total={
                offer.status === 'active'
                  ? formatCollateralAmount(offer.collateral_amount)
                  : undefined
              }
            />
          }
          caption={borrowerCaption}
        />
        <ParticipantCard
          title='Lender'
          subtitle={formatScriptPubkeyAsAddress(lender?.script_pubkey ?? '')}
          isYou={role === 'lender' && !lenderCard.isPlaceholder}
          {...lenderCard}
        />
      </div>

      <div className='bg-surface grid gap-4 rounded-2xl p-4 sm:grid-cols-3 sm:p-6'>
        <Stat {...earningsStat} />
        <Stat label={isBorrowerView ? 'APR' : 'APR After Fees'} value={`${apr.toFixed(2)}%`} />
        <Stat
          label='Loan Term'
          value={
            <>
              {loanTerm.value}
              <span className='text-muted ml-1.5 text-sm font-medium'>{loanTerm.unit}</span>
            </>
          }
        />
      </div>
    </section>
  )
}
