import type { OfferDetails, OfferStatus } from '@/api/indexer/schemas'
import { useAssetPriceUsd } from '@/api/prices/hooks'
import { AssetAmount } from '@/components/AssetAmount'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { APR_TOOLTIP, PROTOCOL_FEE_BPS } from '@/constants/offers'
import { useBlockDate } from '@/hooks/useBlockDate'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import {
  DISPLAY_LOCALE,
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
import LoanRisk from './LoanRisk'
import OfferMetric, { type OfferMetricProps } from './OfferMetric'
import ParticipantCard from './ParticipantCard'

const COLLATERAL_LABEL_BY_STATUS: Record<OfferStatus, string> = {
  pending: 'Locked as Collateral',
  active: 'Collateral Still Locked',
  repaid: 'Collateral Returned',
  claimed: 'Collateral Returned',
  cancelled: 'Collateral Returned',
  liquidated: 'Collateral Went to the Lender',
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
      isIconLeading
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

  const isBorrowerView = role === 'borrower'
  const lenderCard = (() => {
    switch (offer.status) {
      case 'pending':
        return {
          subtitle: 'Open – nobody yet',
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
          amountTooltip: isBorrowerView
            ? 'How much of your repayments has reached the lender, out of the principal plus their interest.'
            : undefined,
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

  const earningsMetric: OfferMetricProps = (() => {
    if (offer.status === 'cancelled') {
      return {
        label: 'Asked For',
        value: renderPrincipal(offer.principal_amount),
        tooltip: `What ${isBorrowerView ? 'you' : 'the borrower'} asked to borrow.`,
      }
    }
    if (isBorrowerView) {
      return {
        label: 'The Loan Costs You',
        value: renderPrincipal(calcInterest(offer.principal_amount, offer.interest_rate)),
        tooltip: 'The interest you pay on top of the principal.',
      }
    }
    if (offer.status === 'liquidated') {
      const unpaidInterest = lenderNetInterest - getRepaidToLender(offer)
      return {
        label: 'No Longer Claimable',
        value: (
          <span className='text-muted'>
            {renderPrincipal(unpaidInterest > 0n ? unpaidInterest : 0n)}
          </span>
        ),
        tooltip: `The interest ${role === 'lender' ? 'you' : 'the lender'} gave up by taking the collateral instead of the repayment.`,
      }
    }
    const isClosed = offer.status === 'repaid' || offer.status === 'claimed'
    return {
      label: isClosed ? 'Total Earnings' : 'Expected Earnings',
      value: (
        <span className='text-success'>
          <AssetAmount
            value={`+ ${formatPrincipal(lenderNetInterest)}`}
            unit={principalAsset.symbol}
            isIconLeading
          />
        </span>
      ),
      tooltip: isClosed
        ? undefined
        : `The interest ${role === 'lender' ? 'you get' : 'the lender gets'} on top of the principal, after the ${PROTOCOL_FEE_BPS / 100}% protocol fee.`,
    }
  })()
  const apr = isBorrowerView
    ? computeApr(offer.interest_rate, loanDurationBlocks)
    : computeAprAfterFees(offer.interest_rate, loanDurationBlocks)

  return (
    <section className='bg-surface-secondary flex min-w-0 flex-col gap-4 rounded-3xl p-4 sm:gap-6 sm:p-6 lg:col-span-2'>
      <div className='flex flex-col gap-4 sm:flex-row sm:gap-6'>
        <ParticipantCard
          participant='borrower'
          title='Borrower'
          subtitle={formatScriptPubkeyAsAddress(borrower?.script_pubkey ?? '')}
          scriptPubkey={borrower?.script_pubkey}
          isYou={role === 'borrower'}
          amountLabel={COLLATERAL_LABEL_BY_STATUS[offer.status]}
          amount={
            <AssetAmount
              value={formatCollateralAmount(shownCollateral)}
              unit={collateralUnit}
              isIconLeading
              total={
                offer.status === 'active' && returnedCollateral > 0n
                  ? formatCollateralAmount(offer.collateral_amount)
                  : undefined
              }
            />
          }
          caption={borrowerCaption}
        />
        <ParticipantCard
          participant='lender'
          title='Lender'
          subtitle={formatScriptPubkeyAsAddress(lender?.script_pubkey ?? '')}
          scriptPubkey={lender?.script_pubkey}
          isYou={role === 'lender' && !lenderCard.isPlaceholder}
          {...lenderCard}
        />
      </div>

      <div className='bg-surface grid gap-4 rounded-sm px-4 py-3 sm:grid-cols-3'>
        <OfferMetric {...earningsMetric} />
        <OfferMetric
          label={isBorrowerView ? 'APR' : 'APR After Fees'}
          value={`${apr.toLocaleString(DISPLAY_LOCALE, { maximumFractionDigits: 2 })}%`}
          tooltip={
            isBorrowerView
              ? APR_TOOLTIP
              : `The annualized rate ${role === 'lender' ? 'you earn' : 'the lender earns'} after the ${PROTOCOL_FEE_BPS / 100}% protocol fee.`
          }
        />
        <OfferMetric
          label='Loan Term'
          value={
            <>
              {loanTerm.value}
              <span className='text-muted ml-1.5 text-sm font-medium'>{loanTerm.unit}</span>
            </>
          }
        />
      </div>

      <LoanRisk offer={offer} role={role} />
    </section>
  )
}
