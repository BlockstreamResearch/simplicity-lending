import { Table, Tooltip } from '@heroui/react'
import type { SortDescriptor } from '@heroui/react/rac'
import type { Key } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { SortField } from '@/api/indexer/methods'
import type { OfferShort, OfferStatus } from '@/api/indexer/schemas'
import ChevronDownIcon from '@/components/icons/ChevronDownIcon'
import ChevronsExpandVerticalIcon from '@/components/icons/ChevronsExpandVerticalIcon'
import TriangleExclamationIcon from '@/components/icons/TriangleExclamationIcon'
import { OfferStatusChip } from '@/components/OfferStatusChip'
import { OfferStatusFilter } from '@/components/OfferStatusFilter'
import { UiPagination } from '@/components/ui/UiPagination'
import type { ConfigAsset } from '@/constants/network-config'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useOpenOffer } from '@/hooks/useOfferModal'
import { useAssetDenomination } from '@/providers/assetDenomination/useAssetDenomination'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useWallet } from '@/providers/wallet/useWallet'
import { formatAmount } from '@/utils/format'
import { resolveActorRole } from '@/utils/offerActions'
import { calcInterest, computeApr, formatOfferTermLeft } from '@/utils/offers'
import { getOfferPendingTx } from '@/utils/pendingTransactions'
import {
  formatPolicyAssetAmount,
  getAssetUnit,
  isPolicyAsset,
} from '@/utils/policyAssetDenomination'

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

interface OffersTableProps<T extends OfferShort> {
  offers: T[]
  currentBlockHeight: number
  collateralAsset?: ConfigAsset
  principalAsset?: ConfigAsset
  page?: number
  pageCount?: number
  emptyMessage?: string
  onPageChange?: (page: number) => void
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
  emptyMessage = 'No offers found',
  onPageChange,
  sort,
  onSortChange,
  statusFilter,
  onStatusFilterChange,
}: OffersTableProps<T>) {
  const { scriptPubkey } = useWallet()
  const { pendingTxs } = usePendingTransactions()
  const { denomination } = useAssetDenomination()
  const { openOffer } = useOpenOffer()
  const collateralUnit = getAssetUnit(denomination, collateralAsset)

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

  const handleRowAction = (key: Key) => {
    const offer = offers.find(o => o.id === String(key))
    if (offer) openOffer(offer)
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

  const scrollWrapperRef = useRef<HTMLDivElement>(null)
  const [reservedHeight, setReservedHeight] = useState<number>()

  const reservesHeight = pageCount !== undefined && pageCount > 1

  useEffect(() => {
    const el = scrollWrapperRef.current
    if (!el || !reservesHeight) return
    const observer = new ResizeObserver(() => {
      setReservedHeight(prev => Math.max(prev ?? 0, el.offsetHeight))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [reservesHeight])

  return (
    <Table variant='secondary'>
      <div
        ref={scrollWrapperRef}
        className='min-w-0'
        style={reservesHeight && reservedHeight ? { minHeight: reservedHeight } : undefined}
      >
        <Table.ScrollContainer>
          <Table.Content
            aria-label='Offers'
            onRowAction={handleRowAction}
            sortDescriptor={sort}
            onSortChange={onSortChange ? handleSortChange : undefined}
          >
            <Table.Header>
              <Table.Column id='collateral' isRowHeader className='w-44 min-w-44'>
                Collateral ({collateralUnit})
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
              dependencies={[
                currentBlockHeight,
                scriptPubkey,
                resolveOfferWarning,
                pendingTxs,
                denomination,
                collateralAsset,
              ]}
              renderEmptyState={() => (
                <div className='bg-surface border-muted flex h-14 items-center rounded border border-dashed px-4 opacity-50'>
                  <span className='text-foreground text-sm font-medium'>
                    {statusFilter?.length ? 'No matching offers' : emptyMessage}
                  </span>
                </div>
              )}
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
                    <Table.Cell>
                      {computeApr(
                        offer.interest_rate,
                        offer.loan_expiration_height - offer.created_at_height,
                      ).toFixed(2)}
                      %
                    </Table.Cell>
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
      </div>
      {onPageChange && !!page && !!pageCount && pageCount > 1 && (
        <Table.Footer className='pr-2 pl-4'>
          <UiPagination currentPage={page} onPageChange={onPageChange} pageCount={pageCount} />
        </Table.Footer>
      )}
    </Table>
  )
}
