import { Skeleton, Table } from '@heroui/react'
import { keepPreviousData } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { useBlockHeight } from '@/api/esplora/hooks'
import { useOffers } from '@/api/indexer/hooks'
import type { OfferShort } from '@/api/indexer/schemas'
import ArrowsRotateIcon from '@/components/icons/ArrowsRotateIcon'
import ChevronsExpandVerticalIcon from '@/components/icons/ChevronsExpandVerticalIcon'
import { OfferStatusBadge } from '@/components/ui/OfferStatusBadge'
import { UiButton } from '@/components/ui/UiButton'
import { UiPagination } from '@/components/ui/UiPagination'
import { ASSET_DECIMALS } from '@/constants/assets'
import { DASHBOARD_REFETCH_INTERVAL_MS, TABLE_PAGE_SIZE } from '@/constants/lending'
import { formatAsset, formatTermLeft } from '@/utils/format'
import { bpsToPercent, calcInterest } from '@/utils/lending'

import type { DisplayOffer } from './useDashboard'

type SortCol = 'collateral_amount' | 'principal_amount' | 'earn' | 'interest_rate' | 'termLeft'
type SortState = { col: SortCol; dir: 'asc' | 'desc' } | null

const FETCH_LIMIT = TABLE_PAGE_SIZE + 1 // n+1 to detect next page without total count

function toDisplayOffer(offer: OfferShort, currentBlockHeight: number): DisplayOffer {
  const termLeft = offer.loan_expiration_time - currentBlockHeight
  const displayStatus = offer.status === 'pending' && termLeft <= 0 ? 'expired' : offer.status
  return {
    ...offer,
    termLeft,
    displayStatus,
    earn: calcInterest(offer.principal_amount, offer.interest_rate),
  }
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
      <ChevronsExpandVerticalIcon
        className={`size-3.5 ${active ? 'text-foreground' : 'text-muted'}`}
      />
    </button>
  )
}

export function OffersTable() {
  const [sort, setSort] = useState<SortState>(null)
  const [page, setPage] = useState(1)

  const offset = (page - 1) * TABLE_PAGE_SIZE

  const offersQuery = useOffers(
    { limit: FETCH_LIMIT, offset },
    { refetchInterval: DASHBOARD_REFETCH_INTERVAL_MS, placeholderData: keepPreviousData },
  )
  const blockHeightQuery = useBlockHeight(DASHBOARD_REFETCH_INTERVAL_MS)
  const currentBlockHeight = blockHeightQuery.data ?? 0

  const rawBatch: OfferShort[] = offersQuery.data ?? []

  const hasNextPage = rawBatch.length > TABLE_PAGE_SIZE
  const pageOffers = rawBatch.slice(0, TABLE_PAGE_SIZE)

  const displayOffers = useMemo<DisplayOffer[]>(
    () => pageOffers.map(o => toDisplayOffer(o, currentBlockHeight)),
    [pageOffers, currentBlockHeight],
  )

  const handleSort = (col: SortCol) => {
    setSort(prev =>
      prev?.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' },
    )
  }

  // Sort applies to current page only (server-side sort not yet supported by API)
  const sorted = useMemo(() => {
    if (!sort) return displayOffers
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...displayOffers].sort((a, b) => {
      const av = a[sort.col]
      const bv = b[sort.col]
      if (av < bv) return -dir
      if (av > bv) return dir
      return 0
    })
  }, [displayOffers, sort])

  const isLoading = offersQuery.isLoading || blockHeightQuery.isLoading
  const isFetching = offersQuery.isFetching || blockHeightQuery.isFetching
  const error = offersQuery.error as Error | null
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
      ) : sorted.length === 0 ? (
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
              <Table.Body items={sorted}>
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
            <UiPagination
              currentPage={page}
              hasNextPage={hasNextPage}
              onPageChange={p => {
                setPage(p)
                setSort(null)
              }}
            />
          </Table.Footer>
        </Table>
      )}
    </div>
  )
}
