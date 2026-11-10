import { Chip, Table } from '@heroui/react'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'

import type { OfferStatus } from '@/api/indexer/schemas'
import ArrowsRotateIcon from '@/components/icons/ArrowsRotateIcon'
import ChevronDownIcon from '@/components/icons/ChevronDownIcon'
import ChevronsExpandVerticalIcon from '@/components/icons/ChevronsExpandVerticalIcon'
import LbtcIcon from '@/components/icons/LbtcIcon'
import UsdtIcon from '@/components/icons/UsdtIcon'
import { OfferStatusChip } from '@/components/OfferStatusChip'
import { OfferStatusFilter } from '@/components/OfferStatusFilter'
import { UiPagination } from '@/components/ui/UiPagination'

import { jitterOffers, MOCK_OFFERS } from '../mock/offers'

const TICK_INTERVAL_MS = 3500
const PAGE_SIZE = 5

type SortField = 'apr' | 'termLeft'
type SortDirection = 'ascending' | 'descending'

function AnimatedValue({ value }: { value: string }) {
  return (
    <span className='relative inline-grid'>
      <AnimatePresence mode='popLayout' initial={false}>
        <motion.span
          key={value}
          initial={{ y: 6, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -6, opacity: 0 }}
          transition={{ duration: 0.25 }}
          className='[grid-area:1/1]'
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

function SortableHeader({
  label,
  active,
  direction,
  onPress,
}: {
  label: string
  active: boolean
  direction: SortDirection
  onPress: () => void
}) {
  return (
    <button type='button' onClick={onPress} className='inline-flex items-center gap-1'>
      {label}
      {active ? (
        <ChevronDownIcon className={`size-3 ${direction === 'ascending' ? 'rotate-180' : ''}`} />
      ) : (
        <ChevronsExpandVerticalIcon className='text-muted size-3' />
      )}
    </button>
  )
}

export function LiveOffersPreview() {
  const [offers, setOffers] = useState(MOCK_OFFERS)
  const [statusFilter, setStatusFilter] = useState<OfferStatus[]>([])
  const [sort, setSort] = useState<{ field: SortField; direction: SortDirection } | null>(null)
  const [page, setPage] = useState(1)

  useEffect(() => {
    const id = window.setInterval(() => setOffers(jitterOffers), TICK_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [])

  const visibleOffers = useMemo(() => {
    let result = offers
    if (statusFilter.length > 0) {
      result = result.filter(offer => statusFilter.includes(offer.status))
    }
    if (sort) {
      const dir = sort.direction === 'ascending' ? 1 : -1
      result = [...result].sort((a, b) =>
        sort.field === 'apr'
          ? (a.apr - b.apr) * dir
          : (a.termLeft === 'Expired' ? -1 : 1) - (b.termLeft === 'Expired' ? -1 : 1),
      )
    }
    return result
  }, [offers, statusFilter, sort])

  const pageCount = Math.max(1, Math.ceil(visibleOffers.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageOffers = visibleOffers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const toggleSort = (field: SortField) => {
    setPage(1)
    setSort(prev => {
      if (prev?.field !== field) return { field, direction: 'descending' }
      if (prev.direction === 'descending') return { field, direction: 'ascending' }
      return null
    })
  }

  return (
    <div className='bg-surface-secondary flex w-full max-w-5xl flex-col gap-6 rounded-2xl p-4 pb-6 shadow-[0px_2px_8px_0px_rgba(0,0,0,0.06),0px_-6px_12px_0px_rgba(0,0,0,0.03),0px_14px_28px_0px_rgba(0,0,0,0.08)] sm:p-6 sm:pb-8'>
      <header className='flex items-center gap-3'>
        <ArrowsRotateIcon className='text-muted animation-duration-[3s] size-5 animate-spin' />
        <p className='text-h4'>Most recent Borrow Offers</p>
      </header>

      <Table variant='secondary'>
        <Table.ScrollContainer className='h-[344px]'>
          <Table.Content aria-label='Most recent borrow offers'>
            <Table.Header>
              <Table.Column id='collateral' isRowHeader className='pl-9'>
                Collateral (LBTC)
              </Table.Column>
              <Table.Column id='loan' className='pl-9'>
                Loan Amount (USDT)
              </Table.Column>
              <Table.Column id='earn' className='pl-9'>
                Earn (USDT)
              </Table.Column>
              <Table.Column id='apr' className='pl-9'>
                <SortableHeader
                  label='APR (%)'
                  active={sort?.field === 'apr'}
                  direction={sort?.direction ?? 'descending'}
                  onPress={() => toggleSort('apr')}
                />
              </Table.Column>
              <Table.Column id='term' className='pl-9'>
                <SortableHeader
                  label='Term Left'
                  active={sort?.field === 'termLeft'}
                  direction={sort?.direction ?? 'descending'}
                  onPress={() => toggleSort('termLeft')}
                />
              </Table.Column>
              <Table.Column id='status' className='w-48 min-w-48 max-w-48 pl-9'>
                <OfferStatusFilter
                  value={statusFilter}
                  onChange={next => {
                    setPage(1)
                    setStatusFilter(next)
                  }}
                />
              </Table.Column>
            </Table.Header>
            <Table.Body
              items={pageOffers}
              renderEmptyState={() => (
                <div className='bg-surface border-muted flex h-14 items-center rounded border border-dashed px-4 opacity-50'>
                  <span className='text-foreground text-sm font-medium'>No matching offers</span>
                </div>
              )}
            >
              {offer => (
                <Table.Row id={offer.id}>
                  <Table.Cell className='pl-9'>
                    <span className='flex items-center gap-1.5 tabular-nums'>
                      <LbtcIcon className='size-4' />
                      {offer.collateral} LBTC
                    </span>
                  </Table.Cell>
                  <Table.Cell className='pl-9'>
                    <span className='flex items-center gap-1.5'>
                      <UsdtIcon className='size-4' />
                      <AnimatedValue value={`${offer.loanAmount.toLocaleString('en-US')} USDT`} />
                    </span>
                  </Table.Cell>
                  <Table.Cell className='pl-9'>
                    <AnimatedValue value={`${offer.earn.toFixed(1)} USDT`} />
                  </Table.Cell>
                  <Table.Cell className='pl-9'>
                    <AnimatedValue value={`${offer.apr.toFixed(2)}%`} />
                  </Table.Cell>
                  <Table.Cell className='pl-9'>
                    {offer.termLeft === 'Expired' ? (
                      <Chip color='default' size='sm'>
                        Expired
                      </Chip>
                    ) : (
                      offer.termLeft
                    )}
                  </Table.Cell>
                  <Table.Cell className='w-48 min-w-48 max-w-48 pl-9'>
                    <OfferStatusChip status={offer.status} />
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
        <Table.Footer className='pr-2 pl-4'>
          <UiPagination currentPage={currentPage} onPageChange={setPage} pageCount={pageCount} />
        </Table.Footer>
      </Table>
    </div>
  )
}
