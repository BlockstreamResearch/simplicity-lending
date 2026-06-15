import { Table } from '@heroui/react'

import type { OfferShort } from '@/api/indexer/schemas'
import { OfferStatusChip } from '@/components/OfferStatusChip'
import type { ConfigAsset } from '@/constants/network-config'
import { formatAmount, formatTermLeft } from '@/utils/format'
import { bpsToPercent, calcInterest, getOfferDisplayStatus, getOfferTermLeft } from '@/utils/offers'

interface BorrowOffersTableProps {
  offers: OfferShort[]
  currentBlockHeight: number
  collateralAsset: ConfigAsset
  principalAsset: ConfigAsset
}

export default function BorrowOffersTable({
  offers,
  currentBlockHeight,
  collateralAsset,
  principalAsset,
}: BorrowOffersTableProps) {
  return (
    <Table variant='secondary'>
      <Table.ScrollContainer>
        <Table.Content aria-label='Your borrows'>
          <Table.Header>
            <Table.Column isRowHeader>Collateral ({collateralAsset.symbol})</Table.Column>
            <Table.Column>Loan Amount ({principalAsset.symbol})</Table.Column>
            <Table.Column>Earn ({principalAsset.symbol})</Table.Column>
            <Table.Column>APR(%)</Table.Column>
            <Table.Column>Term Left</Table.Column>
            <Table.Column>Status</Table.Column>
          </Table.Header>
          <Table.Body items={offers}>
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
    </Table>
  )
}
