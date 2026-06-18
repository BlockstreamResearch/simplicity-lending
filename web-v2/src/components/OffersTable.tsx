import { Table } from '@heroui/react'
import type { Key } from 'react'

import type { OfferShort } from '@/api/indexer/schemas'
import { OfferStatusChip } from '@/components/OfferStatusChip'
import { UiPagination } from '@/components/ui/UiPagination'
import type { ConfigAsset } from '@/constants/network-config'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { formatAmount } from '@/utils/format'
import {
  bpsToPercent,
  calcInterest,
  formatOfferTermLeft,
  getOfferDisplayStatus,
} from '@/utils/offers'

interface OffersTableProps<T extends OfferShort> {
  offers: T[]
  currentBlockHeight: number
  collateralAsset?: ConfigAsset
  principalAsset?: ConfigAsset
  page?: number
  pageCount?: number
  onPageChange?: (page: number) => void
  onRowPress?: (offer: T) => void
}

export default function OffersTable<T extends OfferShort>({
  offers,
  currentBlockHeight,
  collateralAsset = NETWORK_CONFIG.collateralAsset,
  principalAsset = NETWORK_CONFIG.principalAsset,
  page,
  pageCount,
  onPageChange,
  onRowPress,
}: OffersTableProps<T>) {
  const handleRowAction = (key: Key) => {
    if (!onRowPress) return
    const offer = offers.find(o => o.id === String(key))
    if (offer) onRowPress(offer)
  }

  return (
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
          <Table.Body items={offers} dependencies={[currentBlockHeight]}>
            {offer => (
              <Table.Row id={offer.id}>
                <Table.Cell>
                  {formatAmount(offer.collateral_amount, collateralAsset.decimals)}
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
                  <OfferStatusChip status={getOfferDisplayStatus(offer, currentBlockHeight)} />
                </Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
      {page !== undefined && pageCount !== undefined && onPageChange !== undefined && (
        <Table.Footer className='pr-2 pl-4'>
          <UiPagination currentPage={page} onPageChange={onPageChange} pageCount={pageCount} />
        </Table.Footer>
      )}
    </Table>
  )
}
