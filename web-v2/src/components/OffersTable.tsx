import { Table, Tooltip } from '@heroui/react'
import type { Key } from 'react'
import { useCallback, useState } from 'react'

import type { OfferShort } from '@/api/indexer/schemas'
import TriangleExclamationIcon from '@/components/icons/TriangleExclamationIcon'
import OfferActionModal from '@/components/modals/OfferActionModal'
import { OfferStatusChip } from '@/components/OfferStatusChip'
import { UiPagination } from '@/components/ui/UiPagination'
import type { ConfigAsset } from '@/constants/network-config'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useAssetDenomination } from '@/providers/assetDenomination/useAssetDenomination'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { formatAmount } from '@/utils/format'
import { resolveActorRole } from '@/utils/offerActions'
import { bpsToPercent, calcInterest, formatOfferTermLeft } from '@/utils/offers'
import { getOfferPendingTx } from '@/utils/pendingTransactions'
import {
  formatPolicyAssetAmount,
  getPolicyAssetUnit,
  isPolicyAsset,
} from '@/utils/policyAssetDenomination'

const SEVERITY_COLOR = {
  danger: 'text-danger',
  warning: 'text-warning',
} as const

interface OffersTableProps<T extends OfferShort> {
  offers: T[]
  currentBlockHeight: number
  collateralAsset?: ConfigAsset
  principalAsset?: ConfigAsset
  page?: number
  pageCount?: number
  onPageChange?: (page: number) => void
  onActionSuccess?: () => void
}

export default function OffersTable<T extends OfferShort>({
  offers,
  currentBlockHeight,
  collateralAsset = NETWORK_CONFIG.collateralAsset,
  principalAsset = NETWORK_CONFIG.principalAsset,
  page,
  pageCount,
  onPageChange,
  onActionSuccess,
}: OffersTableProps<T>) {
  const { scriptPubkey } = useWallet()
  const { pendingTxs } = usePendingTransactions()
  const { denomination } = useAssetDenomination()
  const collateralUnit = isPolicyAsset(collateralAsset)
    ? getPolicyAssetUnit(denomination, collateralAsset)
    : collateralAsset.symbol

  const resolveOfferWarning = useCallback(
    (offer: OfferShort): { severity: keyof typeof SEVERITY_COLOR; message: string } | null => {
      const role = resolveActorRole(offer, scriptPubkey)
      const expired = currentBlockHeight > offer.loan_expiration_height

      if (role === 'lender') {
        if (offer.status === 'active' && expired)
          return { severity: 'danger', message: 'Loan expired. You can liquidate the collateral.' }
        if (offer.status === 'repaid')
          return { severity: 'warning', message: 'Claim your loan repayment.' }
      }
      if (role === 'borrower') {
        if (offer.status === 'pending' && expired)
          return {
            severity: 'danger',
            message: 'Offer expired. Cancel to reclaim your collateral.',
          }
        if (offer.status === 'active' && offer.borrower_principal_utxo)
          return { severity: 'warning', message: 'Claim your loan principal.' }
      }
      return null
    },
    [scriptPubkey, currentBlockHeight],
  )

  const [selectedOffer, setSelectedOffer] = useState<T | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const handleRowAction = (key: Key) => {
    const offer = offers.find(o => o.id === String(key))
    if (offer) {
      setSelectedOffer(offer)
      setIsModalOpen(true)
    }
  }

  return (
    <>
      <Table variant='secondary'>
        <Table.ScrollContainer>
          <Table.Content aria-label='Borrow Offers' onRowAction={handleRowAction}>
            <Table.Header>
              <Table.Column isRowHeader className='w-44 min-w-44'>
                Collateral ({collateralUnit})
              </Table.Column>
              <Table.Column>Loan Amount ({principalAsset.symbol})</Table.Column>
              <Table.Column>Earn ({principalAsset.symbol})</Table.Column>
              <Table.Column>APR (%)</Table.Column>
              <Table.Column>Term Left</Table.Column>
              <Table.Column className='min-w-36'>Status</Table.Column>
            </Table.Header>
            <Table.Body
              items={offers}
              dependencies={[
                currentBlockHeight,
                scriptPubkey,
                resolveOfferWarning,
                pendingTxs,
                denomination,
                collateralAsset,
              ]}
            >
              {offer => {
                const isProcessing = Boolean(getOfferPendingTx(offer.id, pendingTxs))
                const warning = isProcessing ? null : resolveOfferWarning(offer)
                return (
                  <Table.Row id={offer.id}>
                    <Table.Cell className='w-44 min-w-44'>
                      <span className='inline-flex items-center gap-1.5 tabular-nums'>
                        {isPolicyAsset(collateralAsset)
                          ? formatPolicyAssetAmount(
                              offer.collateral_amount,
                              denomination,
                              collateralAsset,
                            )
                          : formatAmount(offer.collateral_amount, collateralAsset.decimals)}
                        {warning && (
                          <Tooltip>
                            <Tooltip.Trigger
                              className={`inline-flex ${SEVERITY_COLOR[warning.severity]}`}
                            >
                              <TriangleExclamationIcon className='size-3.5' />
                            </Tooltip.Trigger>
                            <Tooltip.Content>{warning.message}</Tooltip.Content>
                          </Tooltip>
                        )}
                      </span>
                    </Table.Cell>
                    <Table.Cell>
                      {formatAmount(offer.principal_amount, principalAsset.decimals)}
                    </Table.Cell>
                    <Table.Cell>
                      {formatAmount(
                        calcInterest(offer.principal_amount, offer.interest_rate),
                        principalAsset.decimals,
                      )}
                    </Table.Cell>
                    <Table.Cell>{bpsToPercent(offer.interest_rate)}</Table.Cell>
                    <Table.Cell>{formatOfferTermLeft(offer, currentBlockHeight)}</Table.Cell>
                    <Table.Cell className='min-w-36'>
                      <OfferStatusChip status={offer.status} isProcessing={isProcessing} />
                    </Table.Cell>
                  </Table.Row>
                )
              }}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
        {page !== undefined && pageCount !== undefined && onPageChange !== undefined && (
          <Table.Footer className='pr-2 pl-4'>
            <UiPagination currentPage={page} onPageChange={onPageChange} pageCount={pageCount} />
          </Table.Footer>
        )}
      </Table>

      <OfferActionModal
        offer={selectedOffer}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => {
          setIsModalOpen(false)
          onActionSuccess?.()
        }}
      />
    </>
  )
}
