import { Spinner } from '@heroui/react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'

import { ApiError } from '@/api/errors'
import { useBlockHeight } from '@/api/esplora/hooks'
import { useOffer } from '@/api/indexer/hooks'
import { useAssetPriceUsd } from '@/api/prices/hooks'
import BackLink from '@/components/BackLink'
import CardAlert from '@/components/CardAlert'
import ArrowDownIcon from '@/components/icons/ArrowDownIcon'
import CheckIcon from '@/components/icons/CheckIcon'
import ShareNodesIcon from '@/components/icons/ShareNodesIcon'
import { OffersLoadError } from '@/components/OffersLoadError'
import { OfferStatusChip } from '@/components/OfferStatusChip'
import { UiButton } from '@/components/ui/UiButton'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useFormatAmount } from '@/hooks/useFormatAmount'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { resolveActorRole } from '@/utils/offerActions'
import { getOfferPendingTx } from '@/utils/pendingTransactions'

import OfferActivity from './components/Activity'
import { LOAN_RISK_ID } from './components/LoanRisk'
import OfferSidebar, { OFFER_SIDEBAR_ID } from './components/OfferSidebar'
import OfferSummary from './components/OfferSummary'
import { getOfferLtv } from './helpers'

const OFFER_NOT_FOUND_HTTP_STATUS = 404
const INVALID_OFFER_ID_HTTP_STATUS = 400

const UNCLAIMED_PRINCIPAL_OVERDUE_HINT =
  'The lender can now liquidate your collateral. Claim your loan first, then repay to keep it.'
const DEFAULT_LOCATION_KEY = 'default'

const OVERDUE_HINT_BY_ROLE = {
  borrower: 'The lender can now liquidate your collateral. Repay to keep it.',
  lender: 'The borrower can still repay until you liquidate.',
} as const

export default function OfferPage() {
  const { offerId = '' } = useParams()
  const navigate = useNavigate()
  const { key: locationKey } = useLocation()
  const canGoBack = locationKey !== DEFAULT_LOCATION_KEY
  const [isLinkCopied, copyLink] = useCopyToClipboard()
  const { data: offer, error, refetch } = useOffer(offerId)
  const { pendingTxs } = usePendingTransactions()
  const { scriptPubkey } = useWallet()
  const { data: currentBlockHeight } = useBlockHeight()
  const { formatPrincipalAmount } = useFormatAmount()
  const collateralPriceUsd = useAssetPriceUsd(NETWORK_CONFIG.collateralAsset.id)
  const { icon: CollateralIcon } = NETWORK_CONFIG.collateralAsset
  const { icon: PrincipalIcon } = NETWORK_CONFIG.principalAsset
  const isNotFound =
    error instanceof ApiError &&
    (error.status === OFFER_NOT_FOUND_HTTP_STATUS || error.status === INVALID_OFFER_ID_HTTP_STATUS)

  return (
    <div className='flex flex-col gap-6'>
      <BackLink
        label='Back'
        onClick={event => {
          if (!canGoBack) return
          event.preventDefault()
          void navigate(-1)
        }}
      />

      {(() => {
        if (offer) {
          const role = resolveActorRole(offer, scriptPubkey)
          const isOverdue =
            offer.status === 'active' && currentBlockHeight > offer.loan_expiration_height
          const overdueHint = (() => {
            if (!isOverdue || role === 'guest') return null
            if (role === 'borrower' && offer.borrower_principal_utxo) {
              return UNCLAIMED_PRINCIPAL_OVERDUE_HINT
            }
            return OVERDUE_HINT_BY_ROLE[role]
          })()
          const isUnderCollateralized =
            role === 'lender' &&
            offer.status === 'active' &&
            (getOfferLtv(offer, collateralPriceUsd) ?? 0) >= 1
          const banner = (() => {
            if (isUnderCollateralized && isOverdue) {
              return {
                title: 'The deadline has passed and the collateral is worth less than the debt',
                body: `Liquidating now gets you collateral worth less than the unpaid debt. ${OVERDUE_HINT_BY_ROLE.lender}`,
                action: 'What to do',
                targetId: OFFER_SIDEBAR_ID,
              }
            }
            if (isUnderCollateralized) {
              return {
                title: `${NETWORK_CONFIG.collateralAsset.symbol} fell – the collateral is now worth less than the debt`,
                body: "If the borrower doesn't repay by the deadline, the collateral you'd take is worth less than the unpaid debt.",
                action: 'See Loan Risk',
                targetId: LOAN_RISK_ID,
              }
            }
            if (overdueHint) {
              return {
                title: `The deadline has passed with ${formatPrincipalAmount(offer.current_debt)} still unpaid`,
                body: overdueHint,
                action: 'What to do',
                targetId: OFFER_SIDEBAR_ID,
              }
            }
            return null
          })()

          return (
            <>
              <header className='flex flex-wrap items-center gap-3'>
                <span className='flex -space-x-1.5' aria-hidden='true'>
                  <span className='size-9 overflow-hidden rounded-full'>
                    <CollateralIcon className='size-full scale-120' />
                  </span>
                  <span className='ring-surface relative size-9 overflow-hidden rounded-full ring-2'>
                    <PrincipalIcon className='size-full scale-120' />
                  </span>
                </span>
                <h2 className='text-h2'>Offer ID #{offer.id}</h2>
                <OfferStatusChip
                  status={offer.status}
                  isProcessing={Boolean(getOfferPendingTx(offer.id, pendingTxs))}
                />
                <UiButton
                  className='ml-auto'
                  variant='tertiary'
                  size='sm'
                  isIconOnly
                  aria-label='Copy offer link'
                  onPress={() => copyLink(window.location.href)}
                >
                  {isLinkCopied ? (
                    <CheckIcon className='size-4' />
                  ) : (
                    <ShareNodesIcon className='size-4' />
                  )}
                </UiButton>
              </header>

              {banner && (
                <CardAlert
                  variant='danger'
                  isFilled
                  role='alert'
                  title={banner.title}
                  description={banner.body}
                  actionLabel={banner.action}
                  actionIcon={<ArrowDownIcon className='size-4' />}
                  onAction={() =>
                    document.getElementById(banner.targetId)?.scrollIntoView({ behavior: 'smooth' })
                  }
                />
              )}

              <div className='grid items-start gap-6 lg:grid-cols-3'>
                <OfferSummary offer={offer} role={role} />
                <OfferSidebar offer={offer} role={role} />
                <OfferActivity offer={offer} role={role} />
              </div>
            </>
          )
        }

        if (isNotFound) {
          return (
            <div className='bg-surface-secondary flex flex-col items-center gap-4 rounded-2xl p-12 text-center'>
              <p className='text-muted'>Offer #{offerId} not found.</p>
            </div>
          )
        }

        if (error) {
          return (
            <OffersLoadError
              title='Couldn’t load the offer'
              error={error}
              onRetry={() => void refetch()}
            />
          )
        }

        return (
          <div className='bg-surface-secondary flex flex-col items-center gap-4 rounded-2xl p-12 text-center'>
            <Spinner size='md' />
            <p className='text-muted'>Loading offer…</p>
          </div>
        )
      })()}
    </div>
  )
}
