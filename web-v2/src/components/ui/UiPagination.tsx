import { Pagination } from '@heroui/react'
import type { ReactNode } from 'react'

function buildPageList(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  if (current <= 3 || current >= total - 2) {
    return [1, 2, 3, 'ellipsis', total - 2, total - 1, total]
  }
  return [1, 'ellipsis', current - 1, current, current + 1, 'ellipsis', total]
}

interface UiPaginationBaseProps {
  currentPage: number
  onPageChange: (page: number) => void
  summary?: ReactNode
}

// Exactly one mode must be provided:
// pageCount = numbered pages; hasNextPage = prev/next only (no total count).
type UiPaginationProps = UiPaginationBaseProps &
  ({ pageCount: number; hasNextPage?: never } | { hasNextPage: boolean; pageCount?: never })

export function UiPagination({
  currentPage,
  pageCount,
  hasNextPage,
  onPageChange,
  summary,
}: UiPaginationProps) {
  const isLastPage = pageCount !== undefined ? currentPage >= pageCount : !hasNextPage

  return (
    <Pagination>
      {summary && <Pagination.Summary>{summary}</Pagination.Summary>}
      <Pagination.Content>
        <Pagination.Item>
          <Pagination.Previous
            isDisabled={currentPage <= 1}
            onPress={() => onPageChange(currentPage - 1)}
          >
            <Pagination.PreviousIcon />
            Previous
          </Pagination.Previous>
        </Pagination.Item>

        {pageCount !== undefined &&
          buildPageList(currentPage, pageCount).map((p, idx) =>
            p === 'ellipsis' ? (
              <Pagination.Item key={`e-${idx}`}>
                <Pagination.Ellipsis />
              </Pagination.Item>
            ) : (
              <Pagination.Item key={p}>
                <Pagination.Link isActive={p === currentPage} onPress={() => onPageChange(p)}>
                  {p}
                </Pagination.Link>
              </Pagination.Item>
            ),
          )}

        {pageCount === undefined && (
          <Pagination.Item>
            <Pagination.Link isActive>{currentPage}</Pagination.Link>
          </Pagination.Item>
        )}

        <Pagination.Item>
          <Pagination.Next isDisabled={isLastPage} onPress={() => onPageChange(currentPage + 1)}>
            Next
            <Pagination.NextIcon />
          </Pagination.Next>
        </Pagination.Item>
      </Pagination.Content>
    </Pagination>
  )
}
