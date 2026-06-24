import type { SortDescriptor } from '@heroui/react/rac'
import { useMemo, useState } from 'react'

import type { ListOffersParams, SortField } from '@/api/indexer/methods'
import type { OfferStatus } from '@/api/indexer/schemas'

interface UseOfferListControlsOptions {
  pageSize: number
  status?: OfferStatus
  defaultSort?: SortDescriptor
}

export function useOfferListControls({
  pageSize,
  status,
  defaultSort,
}: UseOfferListControlsOptions) {
  const [page, setPage] = useState(1)
  const [sort, setSortState] = useState<SortDescriptor | undefined>(defaultSort)
  const [statusFilter, setStatusFilterState] = useState<OfferStatus[]>([])

  const setSort = (next?: SortDescriptor) => {
    setSortState(next)
    setPage(1)
  }

  const setStatusFilter = (next: OfferStatus[]) => {
    setStatusFilterState(next)
    setPage(1)
  }

  const params: ListOffersParams = useMemo(
    () => ({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      sortBy: sort?.column as SortField | undefined,
      sortDir: sort ? (sort.direction === 'ascending' ? 'asc' : 'desc') : undefined,
      status: status ?? (statusFilter.length ? statusFilter : undefined),
    }),
    [pageSize, page, sort, statusFilter, status],
  )

  return { page, setPage, sort, setSort, statusFilter, setStatusFilter, params }
}
