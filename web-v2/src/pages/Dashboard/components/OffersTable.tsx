import { Table } from '@heroui/react'

import type { OfferShort } from '@/api/indexer/schemas'
import { OfferStatusChip } from '@/components/OfferStatusChip'
import { UiPagination } from '@/components/ui/UiPagination'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { formatAmount, formatTermLeft } from '@/utils/format'
import { bpsToPercent, calcInterest, getOfferDisplayStatus, getOfferTermLeft } from '@/utils/offers'

interface OffersTableProps {
  offers: OfferShort[]
  currentBlockHeight: number
  page: number
  hasNextPage: boolean
  onPageChange: (page: number) => void
}

// TODO(backend): re-enable column sorting once /offers honors sort_by/sort_dir.
export function OffersTable({
  offers,
  currentBlockHeight,
  page,
  hasNextPage,
  onPageChange,
}: OffersTableProps) {
  return (
    <Table variant='secondary'>
      <Table.ScrollContainer>
        <Table.Content aria-label='Most recent Borrow Offers'>
          <Table.Header>
            <Table.Column isRowHeader>
              Collateral ({NETWORK_CONFIG.collateralAsset.symbol})
            </Table.Column>
            <Table.Column>Loan Amount ({NETWORK_CONFIG.principalAsset.symbol})</Table.Column>
            <Table.Column>Earn ({NETWORK_CONFIG.principalAsset.symbol})</Table.Column>
            <Table.Column>APR (%)</Table.Column>
            <Table.Column>Term Left</Table.Column>
            <Table.Column>Status</Table.Column>
          </Table.Header>
          <Table.Body items={offers}>
            {offer => (
              <Table.Row id={offer.id}>
                <Table.Cell>
                  {formatAmount(offer.collateral_amount, NETWORK_CONFIG.collateralAsset.decimals)}
                </Table.Cell>
                <Table.Cell>
                  {formatAmount(offer.principal_amount, NETWORK_CONFIG.principalAsset.decimals)}
                </Table.Cell>
                <Table.Cell>
                  {formatAmount(
                    calcInterest(offer.principal_amount, offer.interest_rate),
                    NETWORK_CONFIG.principalAsset.decimals,
                  )}
                </Table.Cell>
                <Table.Cell>{bpsToPercent(offer.interest_rate)}</Table.Cell>
                <Table.Cell>
                  {formatTermLeft(getOfferTermLeft(offer, currentBlockHeight))}
                </Table.Cell>
                <Table.Cell>
                  <OfferStatusChip status={getOfferDisplayStatus(offer, currentBlockHeight)} />
                </Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
      <Table.Footer className='pr-2 pl-4'>
        <UiPagination currentPage={page} hasNextPage={hasNextPage} onPageChange={onPageChange} />
      </Table.Footer>
    </Table>
  )
}
