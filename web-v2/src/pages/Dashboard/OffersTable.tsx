import { Skeleton, Table } from '@heroui/react'
import { keepPreviousData } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import { useOffers } from '@/api/indexer/hooks'
import type { OfferShort } from '@/api/indexer/schemas'
import ArrowsRotateIcon from '@/components/icons/ArrowsRotateIcon'
import ChevronDownIcon from '@/components/icons/ChevronDownIcon'
import ChevronsExpandVerticalIcon from '@/components/icons/ChevronsExpandVerticalIcon'
import { OfferStatusBadge } from '@/components/ui/OfferStatusBadge'
import { UiButton } from '@/components/ui/UiButton'
import { UiPagination } from '@/components/ui/UiPagination'
import { ASSET_DECIMALS } from '@/constants/assets'
import { DASHBOARD_REFETCH_INTERVAL_MS, TABLE_PAGE_SIZE } from '@/constants/lending'
import { formatAsset, formatTermLeft } from '@/utils/format'
import { bpsToPercent, type DisplayOffer, toDisplayOffer } from '@/utils/lending'

type SortCol = 'collateral_amount' | 'principal_amount' | 'earn' | 'interest_rate' | 'termLeft'
type SortState = { col: SortCol; dir: 'asc' | 'desc' } | null

// UI sort columns → API fields (termLeft sorts by expiration height).
const SORT_FIELD: Record<SortCol, string> = {
  collateral_amount: 'collateral_amount',
  principal_amount: 'principal_amount',
  earn: 'earn',
  interest_rate: 'interest_rate',
  termLeft: 'loan_expiration_time',
}

function SortableHeader({
  label,
  col,
  sort,
  onSort,
}: {
  label: string
  col: SortCol
  sort: SortState
  onSort: (col: SortCol) => void
}) {
  const active = sort?.col === col
  return (
    <button
      type='button'
      onClick={() => onSort(col)}
      className='hover:text-foreground inline-flex items-center gap-1'
    >
      {label}
      {active ? (
        <ChevronDownIcon
          className={`text-foreground size-3.5 ${sort?.dir === 'asc' ? 'rotate-180' : ''}`}
        />
      ) : (
        <ChevronsExpandVerticalIcon className='text-muted size-3.5' />
      )}
    </button>
  )
}

export function OffersTable() {
  const [sort, setSort] = useState<SortState>(null)
  const [page, setPage] = useState(1)

  const offset = (page - 1) * TABLE_PAGE_SIZE

  const offersQuery = useOffers(
    {
      limit: TABLE_PAGE_SIZE + 1,
      offset,
      sortBy: sort ? SORT_FIELD[sort.col] : undefined,
      sortDir: sort?.dir,
    },
    { refetchInterval: DASHBOARD_REFETCH_INTERVAL_MS, placeholderData: keepPreviousData },
  )
  const blockHeightQuery = useBlockHeight(DASHBOARD_REFETCH_INTERVAL_MS)
  const currentBlockHeight = blockHeightQuery.data ?? 0

  const rawBatch: OfferShort[] = offersQuery.data ?? []
  const hasNextPage = rawBatch.length > TABLE_PAGE_SIZE

  const displayOffers = useMemo<DisplayOffer[]>(
    () =>
      (offersQuery.data ?? [])
        .slice(0, TABLE_PAGE_SIZE)
        .map(o => toDisplayOffer(o, currentBlockHeight)),
    [offersQuery.data, currentBlockHeight],
  )

  // Sort is server-side (refetches from offset 0) — reset to page 1.
  const handleSort = (col: SortCol) => {
    setSort(prev =>
      prev?.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' },
    )
    setPage(1)
  }

  const isLoading = offersQuery.isLoading || blockHeightQuery.isLoading
  const isFetching = offersQuery.isFetching || blockHeightQuery.isFetching
  const error = (offersQuery.error ?? blockHeightQuery.error) as Error | null
  const handleRetry = () => {
    void offersQuery.refetch()
    void blockHeightQuery.refetch()
  }

  return (
    <div className='bg-surface-secondary flex flex-col gap-6 rounded-2xl p-4 sm:p-6'>
      <header className='flex items-center gap-3'>
        <button
          type='button'
          aria-label='Refresh offers'
          onClick={handleRetry}
          className='text-muted hover:text-foreground disabled:opacity-60'
          disabled={isFetching}
        >
          <ArrowsRotateIcon className={`size-5 ${isFetching ? 'animate-spin' : ''}`} />
        </button>
        <h3 className='text-h4'>Most recent Borrow Offers</h3>
      </header>

      {isLoading ? (
        <div className='flex flex-col gap-3'>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className='h-10 w-full' />
          ))}
        </div>
      ) : error ? (
        <div className='flex flex-col items-center gap-3 py-10'>
          <p className='text-danger text-sm'>{error.message || 'Failed to load offers.'}</p>
          <UiButton variant='secondary' onPress={handleRetry}>
            Retry
          </UiButton>
        </div>
      ) : displayOffers.length === 0 ? (
        <p className='text-muted py-10 text-center text-sm'>No offers found</p>
      ) : (
        <Table variant='secondary'>
          <Table.ScrollContainer>
            <Table.Content aria-label='Most recent Borrow Offers'>
              <Table.Header>
                <Table.Column isRowHeader>
                  <SortableHeader
                    label='Collateral (LBTC)'
                    col='collateral_amount'
                    sort={sort}
                    onSort={handleSort}
                  />
                </Table.Column>
                <Table.Column>
                  <SortableHeader
                    label='Loan Amount (USDT)'
                    col='principal_amount'
                    sort={sort}
                    onSort={handleSort}
                  />
                </Table.Column>
                <Table.Column>
                  <SortableHeader label='Earn (USDT)' col='earn' sort={sort} onSort={handleSort} />
                </Table.Column>
                <Table.Column>
                  <SortableHeader
                    label='APR (%)'
                    col='interest_rate'
                    sort={sort}
                    onSort={handleSort}
                  />
                </Table.Column>
                <Table.Column>
                  <SortableHeader
                    label='Term Left'
                    col='termLeft'
                    sort={sort}
                    onSort={handleSort}
                  />
                </Table.Column>
                <Table.Column>Status</Table.Column>
              </Table.Header>
              <Table.Body items={displayOffers}>
                {offer => (
                  <Table.Row id={offer.id}>
                    <Table.Cell>
                      {formatAsset(offer.collateral_amount, ASSET_DECIMALS.LBTC)}
                    </Table.Cell>
                    <Table.Cell>
                      {formatAsset(offer.principal_amount, ASSET_DECIMALS.USDT)}
                    </Table.Cell>
                    <Table.Cell>{formatAsset(offer.earn, ASSET_DECIMALS.USDT)}</Table.Cell>
                    <Table.Cell>{bpsToPercent(offer.interest_rate)}</Table.Cell>
                    <Table.Cell>{formatTermLeft(offer.termLeft)}</Table.Cell>
                    <Table.Cell>
                      <OfferStatusBadge status={offer.displayStatus} />
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
          <Table.Footer className='pr-2 pl-4'>
            <UiPagination currentPage={page} hasNextPage={hasNextPage} onPageChange={setPage} />
          </Table.Footer>
        </Table>
      )}
    </div>
  )
}
