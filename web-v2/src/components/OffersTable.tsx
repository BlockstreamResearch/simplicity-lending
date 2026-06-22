import { Table, Tooltip } from '@heroui/react'
import type { Key } from 'react'
import { useState } from 'react'

import type { OfferShort } from '@/api/indexer/schemas'
import TriangleExclamationIcon from '@/components/icons/TriangleExclamationIcon'
import OfferActionModal from '@/components/modals/OfferActionModal'
import { OfferStatusChip } from '@/components/OfferStatusChip'
import { UiPagination } from '@/components/ui/UiPagination'
import type { ConfigAsset } from '@/constants/network-config'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useWallet } from '@/providers/wallet/useWallet'
import { formatAmount } from '@/utils/format'
import { resolveOfferInteraction } from '@/utils/offerActions'
import { bpsToPercent, calcInterest, formatOfferTermLeft } from '@/utils/offers'

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
              <Table.Column isRowHeader>Collateral ({collateralAsset.symbol})</Table.Column>
              <Table.Column>Loan Amount ({principalAsset.symbol})</Table.Column>
              <Table.Column>Earn ({principalAsset.symbol})</Table.Column>
              <Table.Column>APR (%)</Table.Column>
              <Table.Column>Term Left</Table.Column>
              <Table.Column>Status</Table.Column>
            </Table.Header>
            <Table.Body items={offers} dependencies={[currentBlockHeight, scriptPubkey]}>
              {offer => {
                const { severity, message } = resolveOfferInteraction(
                  offer,
                  scriptPubkey,
                  currentBlockHeight,
                )
                return (
                  <Table.Row id={offer.id}>
                    <Table.Cell>
                      <span className='inline-flex items-center gap-1.5'>
                        {formatAmount(offer.collateral_amount, collateralAsset.decimals)}
                        {severity && message && (
                          <Tooltip>
                            <Tooltip.Trigger className={`inline-flex ${SEVERITY_COLOR[severity]}`}>
                              <TriangleExclamationIcon className='size-3.5' />
                            </Tooltip.Trigger>
                            <Tooltip.Content>{message}</Tooltip.Content>
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
                    <Table.Cell>
                      <OfferStatusChip status={offer.status} />
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
