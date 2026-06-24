import { Table, Tooltip } from '@heroui/react'
import type { SortDescriptor } from '@heroui/react/rac'
import type { Key } from 'react'
import { useCallback, useState } from 'react'

import type { SortField } from '@/api/indexer/methods'
import type { OfferShort, OfferStatus } from '@/api/indexer/schemas'
import ChevronDownIcon from '@/components/icons/ChevronDownIcon'
import ChevronsExpandVerticalIcon from '@/components/icons/ChevronsExpandVerticalIcon'
import TriangleExclamationIcon from '@/components/icons/TriangleExclamationIcon'
import OfferActionModal from '@/components/modals/OfferActionModal'
import { OfferStatusChip } from '@/components/OfferStatusChip'
import { OfferStatusFilter } from '@/components/OfferStatusFilter'
import { UiPagination } from '@/components/ui/UiPagination'
import type { ConfigAsset } from '@/constants/network-config'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useWallet } from '@/providers/wallet/useWallet'
import { formatAmount } from '@/utils/format'
import { resolveActorRole } from '@/utils/offerActions'
import { bpsToPercent, calcInterest, formatOfferTermLeft } from '@/utils/offers'

const SEVERITY_COLOR = {
  danger: 'text-danger',
  warning: 'text-warning',
} as const

type SortDirection = SortDescriptor['direction']

function SortIndicator({ direction }: { direction?: SortDirection }) {
  if (!direction) return <ChevronsExpandVerticalIcon className='text-muted size-3' />
  return <ChevronDownIcon className={`size-3 ${direction === 'ascending' ? 'rotate-180' : ''}`} />
}

function SortableColumn({
  id,
  label,
  sortable,
}: {
  id: SortField
  label: string
  sortable: boolean
}) {
  return (
    <Table.Column id={id} allowsSorting={sortable}>
      {sortable
        ? ({ sortDirection }) => (
            <span className='inline-flex items-center gap-1'>
              {label}
              <SortIndicator direction={sortDirection} />
            </span>
          )
        : label}
    </Table.Column>
  )
}

function StatusColumn({
  filter,
  onChange,
}: {
  filter?: OfferStatus[]
  onChange?: (next: OfferStatus[]) => void
}) {
  return (
    <Table.Column id='status'>
      {onChange ? <OfferStatusFilter value={filter ?? []} onChange={onChange} /> : 'Status'}
    </Table.Column>
  )
}

function EmptyOffers() {
  return <div className='text-muted py-10 text-center text-sm'>No matching offers</div>
}

interface OffersTableProps<T extends OfferShort> {
  offers: T[]
  currentBlockHeight: number
  collateralAsset?: ConfigAsset
  principalAsset?: ConfigAsset
  page?: number
  pageCount?: number
  onPageChange?: (page: number) => void
  onActionSuccess?: () => void
  sort?: SortDescriptor
  onSortChange?: (sort?: SortDescriptor) => void
  statusFilter?: OfferStatus[]
  onStatusFilterChange?: (next: OfferStatus[]) => void
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
  sort,
  onSortChange,
  statusFilter,
  onStatusFilterChange,
}: OffersTableProps<T>) {
  const { scriptPubkey } = useWallet()

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

  const handleSortChange = (descriptor: SortDescriptor) => {
    if (!onSortChange) return
    if (sort?.column !== descriptor.column) {
      onSortChange({ column: descriptor.column, direction: 'descending' })
    } else if (sort.direction === 'descending') {
      onSortChange({ column: descriptor.column, direction: 'ascending' })
    } else {
      onSortChange(undefined)
    }
  }

  return (
    <>
      <Table variant='secondary'>
        <Table.ScrollContainer>
          <Table.Content
            aria-label='Offers'
            onRowAction={handleRowAction}
            sortDescriptor={sort}
            onSortChange={onSortChange ? handleSortChange : undefined}
          >
            <Table.Header>
              <Table.Column id='collateral' isRowHeader>
                Collateral ({collateralAsset.symbol})
              </Table.Column>
              <Table.Column id='loan_amount'>Loan Amount ({principalAsset.symbol})</Table.Column>
              <Table.Column id='earn'>Earn ({principalAsset.symbol})</Table.Column>
              <SortableColumn id='interest_rate' label='APR (%)' sortable={!!onSortChange} />
              <SortableColumn
                id='loan_expiration_height'
                label='Term Left'
                sortable={!!onSortChange}
              />
              <StatusColumn filter={statusFilter} onChange={onStatusFilterChange} />
            </Table.Header>
            <Table.Body
              items={offers}
              dependencies={[currentBlockHeight, scriptPubkey, resolveOfferWarning]}
              renderEmptyState={EmptyOffers}
            >
              {offer => {
                const warning = resolveOfferWarning(offer)
                return (
                  <Table.Row id={offer.id}>
                    <Table.Cell>
                      <span className='inline-flex items-center gap-1.5'>
                        {formatAmount(offer.collateral_amount, collateralAsset.decimals)}
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
                    <Table.Cell>
                      <OfferStatusChip status={offer.status} />
                    </Table.Cell>
                  </Table.Row>
                )
              }}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
        {page && pageCount && pageCount > 1 && onPageChange && (
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
