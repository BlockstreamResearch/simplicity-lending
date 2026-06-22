import type { ListBoxItemRootProps } from '@heroui/react'
import { Card, Chip, Pagination, Spinner, Table } from '@heroui/react'
import type { ReactNode, SVGProps } from 'react'
import { useState } from 'react'

import CoinsIcon from '@/components/icons/CoinsIcon'
import { UiButton } from '@/components/ui/UiButton'
import { UiCombobox } from '@/components/ui/UiCombobox'
import { UiModal } from '@/components/ui/UiModal'
import { UiSelect } from '@/components/ui/UiSelect'
import { UiTextField } from '@/components/ui/UiTextField'

const SearchIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox='0 0 16 16' fill='none' aria-hidden {...props}>
    <circle cx='7' cy='7' r='5' stroke='currentColor' strokeWidth='1.5' />
    <path d='m11 11 3 3' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
  </svg>
)

const PlusIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox='0 0 16 16' fill='none' aria-hidden {...props}>
    <path d='M8 3v10M3 8h10' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
  </svg>
)

const TrashIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox='0 0 16 16' fill='none' aria-hidden {...props}>
    <path
      d='M3 4h10M6 4V2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5V4m-5 0v8a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
    />
  </svg>
)

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className='border-separator border-b py-10 last:border-b-0'>
      <header className='mb-6'>
        <h2 className='text-h2'>{title}</h2>
        {description && <p className='text-muted mt-1 max-w-2xl text-sm'>{description}</p>}
      </header>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='flex flex-col gap-3 py-3'>
      <h3 className='text-muted text-xs font-medium tracking-wide uppercase'>{label}</h3>
      <div className='flex flex-wrap items-center gap-3'>{children}</div>
    </div>
  )
}

type Swatch = { label: string; className: string; note: string; fg?: string }
type Family = { name: string; description: string; swatches: Swatch[] }

const TYPOGRAPHY: { name: string; className: string; meta: string }[] = [
  { name: 'Heading 1', className: 'text-h1', meta: '36 / 40 / 800' },
  { name: 'Display (balance)', className: 'text-display', meta: '30 / 36 / 700' },
  { name: 'Heading 2', className: 'text-h2', meta: '24 / 32 / 700' },
  { name: 'Heading 3', className: 'text-h3', meta: '20 / 28 / 600' },
  { name: 'Heading 4', className: 'text-h4', meta: '16 / 24 / 600' },
  { name: 'Body base', className: 'text-base', meta: '16 / 24 / 400' },
  { name: 'Body base medium', className: 'text-base font-medium', meta: '16 / 24 / 500' },
  { name: 'Body sm', className: 'text-sm', meta: '14 / 20 / 400' },
  { name: 'Body sm medium', className: 'text-sm font-medium', meta: '14 / 20 / 500' },
  { name: 'Body xs', className: 'text-xs', meta: '12 / 16 / 400' },
  { name: 'Mono', className: 'font-mono text-sm', meta: 'system mono' },
]

const COLOR_FAMILIES: Family[] = [
  {
    name: 'Accent',
    description: 'Primary brand colour.',
    swatches: [
      { label: 'Accent', className: 'bg-accent', note: '#2706CF', fg: 'text-accent-foreground' },
      {
        label: 'Hover',
        className: 'bg-accent-hover',
        note: 'derived',
        fg: 'text-accent-foreground',
      },
      { label: 'Foreground', className: 'bg-accent-foreground', note: '#FCFCFC' },
      {
        label: 'Soft',
        className: 'bg-accent-soft',
        note: 'accent · 15%',
        fg: 'text-accent-soft-foreground',
      },
      {
        label: 'Soft Hover',
        className: 'bg-accent-soft-hover',
        note: 'accent · 20%',
        fg: 'text-accent-soft-foreground',
      },
    ],
  },
  {
    name: 'Default',
    description: 'Neutral surfaces.',
    swatches: [
      { label: 'Default', className: 'bg-default', note: '#EBEBEC', fg: 'text-default-foreground' },
      {
        label: 'Hover',
        className: 'bg-default-hover',
        note: 'derived',
        fg: 'text-default-foreground',
      },
      { label: 'Foreground', className: 'bg-default-foreground', note: '#18181B' },
    ],
  },
  {
    name: 'Success',
    description: 'Positive states.',
    swatches: [
      { label: 'Success', className: 'bg-success', note: '#17C964', fg: 'text-success-foreground' },
      {
        label: 'Hover',
        className: 'bg-success-hover',
        note: 'derived',
        fg: 'text-success-foreground',
      },
      {
        label: 'Soft',
        className: 'bg-success-soft',
        note: 'success · 15%',
        fg: 'text-success-soft-foreground',
      },
    ],
  },
  {
    name: 'Warning',
    description: 'Caution states.',
    swatches: [
      { label: 'Warning', className: 'bg-warning', note: '#F5A524', fg: 'text-warning-foreground' },
      {
        label: 'Hover',
        className: 'bg-warning-hover',
        note: 'derived',
        fg: 'text-warning-foreground',
      },
      {
        label: 'Soft',
        className: 'bg-warning-soft',
        note: 'warning · 15%',
        fg: 'text-warning-soft-foreground',
      },
    ],
  },
  {
    name: 'Danger',
    description: 'Destructive states.',
    swatches: [
      { label: 'Danger', className: 'bg-danger', note: '#FF383C', fg: 'text-danger-foreground' },
      {
        label: 'Hover',
        className: 'bg-danger-hover',
        note: 'derived',
        fg: 'text-danger-foreground',
      },
      {
        label: 'Soft',
        className: 'bg-danger-soft',
        note: 'danger · 15%',
        fg: 'text-danger-soft-foreground',
      },
    ],
  },
  {
    name: 'Background',
    description: 'Canvas tiers.',
    swatches: [
      { label: 'Background', className: 'bg-background', note: '#F5F5F5' },
      { label: 'Secondary', className: 'bg-background-secondary', note: '#EBEBEB' },
      { label: 'Tertiary', className: 'bg-background-tertiary', note: '#E1E1E1' },
      { label: 'Inverse', className: 'bg-background-inverse', note: '#18181B', fg: 'text-surface' },
    ],
  },
  {
    name: 'Surface',
    description: 'Cards, panels, modals.',
    swatches: [
      { label: 'Surface', className: 'bg-surface', note: '#FFFFFF' },
      { label: 'Secondary', className: 'bg-surface-secondary', note: '#FAFAFA' },
      { label: 'Tertiary', className: 'bg-surface-tertiary', note: '#EFEFF0' },
    ],
  },
  {
    name: 'Separator & Border',
    description: 'Dividers and outlines.',
    swatches: [
      { label: 'Border', className: 'bg-border', note: '#DEDEE0' },
      { label: 'Separator', className: 'bg-separator', note: '#E4E4E7' },
      { label: 'Separator·2', className: 'bg-separator-secondary', note: '#D7D7D7' },
      { label: 'Separator·3', className: 'bg-separator-tertiary', note: '#CDCDCE' },
    ],
  },
  {
    name: 'Other',
    description: 'Overlay, backdrop, focus.',
    swatches: [
      { label: 'Overlay', className: 'bg-overlay', note: '#FFFFFF' },
      { label: 'Backdrop', className: 'bg-backdrop', note: 'rgba(0,0,0,.5)' },
      { label: 'Focus', className: 'bg-focus', note: '= accent' },
      { label: 'Muted', className: 'bg-muted', note: '#71717A' },
    ],
  },
]

const SHADOWS: { label: string; className: string }[] = [
  { label: 'shadow-field', className: 'shadow-field' },
  { label: 'shadow-surface', className: 'shadow-surface' },
  { label: 'shadow-overlay', className: 'shadow-overlay' },
]

const RADII: { label: string; className: string; value: string }[] = [
  { label: 'xs', className: 'rounded-xs', value: '0.125rem' },
  { label: 'sm', className: 'rounded-sm', value: '0.375rem' },
  { label: 'md', className: 'rounded-md', value: '0.5625rem' },
  { label: 'lg (base)', className: 'rounded-lg', value: '0.75rem' },
  { label: 'xl', className: 'rounded-xl', value: '1.125rem' },
  { label: '2xl', className: 'rounded-2xl', value: '1.5rem' },
  { label: 'full', className: 'rounded-full', value: '9999px' },
]

const BUTTON_VARIANTS = [
  'primary',
  'secondary',
  'tertiary',
  'ghost',
  'danger',
  'danger-soft',
] as const
const BUTTON_SIZES = ['sm', 'md', 'lg'] as const

const ASSETS: ListBoxItemRootProps[] = [
  { id: 'btc', textValue: 'Bitcoin' },
  { id: 'lbtc', textValue: 'Liquid Bitcoin' },
  { id: 'usdt', textValue: 'Tether (USDt)' },
  { id: 'eurx', textValue: 'EURx' },
  { id: 'mex', textValue: 'MEX' },
]

function SwatchTile({ label, className, note, fg }: Swatch) {
  return (
    <div className='border-border bg-surface flex flex-col overflow-hidden rounded-md border'>
      <div
        className={`${className} ${fg ?? 'text-foreground'} flex h-14 items-end px-3 py-2 text-xs font-medium`}
      >
        {label}
      </div>
      <div className='border-separator text-muted border-t px-3 py-1.5 font-mono text-[11px]'>
        {note}
      </div>
    </div>
  )
}

type OfferStatus = 'open' | 'matched' | 'expired'

interface Offer {
  id: string
  asset: string
  amount: string
  rate: string
  term: string
  status: OfferStatus
}

const OFFERS: Offer[] = [
  { id: 'o1', asset: 'L-BTC', amount: '1.20', rate: '5.4%', term: '30 days', status: 'open' },
  { id: 'o2', asset: 'USDt', amount: '50,000', rate: '4.1%', term: '14 days', status: 'open' },
  { id: 'o3', asset: 'EURx', amount: '12,300', rate: '3.8%', term: '7 days', status: 'matched' },
  { id: 'o4', asset: 'MEX', amount: '8,500', rate: '6.2%', term: '60 days', status: 'expired' },
  { id: 'o5', asset: 'L-BTC', amount: '0.75', rate: '5.0%', term: '45 days', status: 'open' },
]

const STATUS_CHIP: Record<OfferStatus, { color: 'success' | 'accent' | 'default'; label: string }> =
  {
    open: { color: 'success', label: 'Open' },
    matched: { color: 'accent', label: 'Matched' },
    expired: { color: 'default', label: 'Expired' },
  }

const TOTAL_RESULTS = 120
const DEFAULT_PAGE_SIZE = 10

const PAGE_SIZE_OPTIONS: ListBoxItemRootProps[] = [
  { id: 5, textValue: '5' },
  { id: 10, textValue: '10' },
  { id: 25, textValue: '25' },
  { id: 50, textValue: '50' },
]

const RefreshIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox='0 0 24 24' fill='none' aria-hidden {...props}>
    <path
      d='M20 4v6h-6M4 20v-6h6M4 10a8 8 0 0 1 14-3l2 3M20 14a8 8 0 0 1-14 3l-2-3'
      stroke='currentColor'
      strokeWidth='1.75'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
)

function buildPageList(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  // Figma pattern: near edges show [1,2,3,…,total-2,total-1,total]; middle shows
  // [1,…,current-1,current,current+1,…,total].
  if (current <= 3 || current >= total - 2) {
    return [1, 2, 3, 'ellipsis', total - 2, total - 1, total]
  }
  return [1, 'ellipsis', current - 1, current, current + 1, 'ellipsis', total]
}

function TableDemo() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const pageCount = Math.max(1, Math.ceil(TOTAL_RESULTS / pageSize))
  const currentPage = Math.min(Math.max(1, page), pageCount)
  const pages = buildPageList(currentPage, pageCount)
  const isFirst = currentPage <= 1
  const isLast = currentPage >= pageCount

  const handlePageSizeChange = (key: string | number) => {
    setPageSize(Number(key))
    setPage(1)
  }

  return (
    <div className='bg-surface-secondary flex flex-col gap-6 rounded-2xl p-6'>
      <header className='flex items-center gap-3'>
        <RefreshIcon className='size-6' />
        <h3 className='text-h4'>Most recent Borrow Offers</h3>
      </header>

      <Table variant='secondary'>
        <Table.ScrollContainer>
          <Table.Content aria-label='Most recent Borrow Offers' selectionMode='single'>
            <Table.Header>
              <Table.Column isRowHeader>Asset</Table.Column>
              <Table.Column>Amount</Table.Column>
              <Table.Column>Rate</Table.Column>
              <Table.Column>Term</Table.Column>
              <Table.Column>Status</Table.Column>
            </Table.Header>
            <Table.Body items={OFFERS}>
              {offer => (
                <Table.Row id={offer.id}>
                  <Table.Cell>{offer.asset}</Table.Cell>
                  <Table.Cell>{offer.amount}</Table.Cell>
                  <Table.Cell>{offer.rate}</Table.Cell>
                  <Table.Cell>{offer.term}</Table.Cell>
                  <Table.Cell>
                    <Chip color={STATUS_CHIP[offer.status].color} variant='soft' size='sm'>
                      {STATUS_CHIP[offer.status].label}
                    </Chip>
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
        <Table.Footer className='pr-2 pl-4'>
          <Pagination>
            <Pagination.Summary>
              <span>Showing</span>
              <UiSelect
                options={PAGE_SIZE_OPTIONS}
                value={pageSize}
                onChange={key => handlePageSizeChange(key as string | number)}
                className='w-20'
              />
              <span>of {TOTAL_RESULTS} results</span>
            </Pagination.Summary>
            <Pagination.Content>
              <Pagination.Item>
                <Pagination.Previous isDisabled={isFirst} onPress={() => setPage(currentPage - 1)}>
                  <Pagination.PreviousIcon />
                  Previous
                </Pagination.Previous>
              </Pagination.Item>
              {pages.map((p, idx) =>
                p === 'ellipsis' ? (
                  <Pagination.Item key={`e-${idx}`}>
                    <Pagination.Ellipsis />
                  </Pagination.Item>
                ) : (
                  <Pagination.Item key={p}>
                    <Pagination.Link isActive={p === currentPage} onPress={() => setPage(p)}>
                      {p}
                    </Pagination.Link>
                  </Pagination.Item>
                ),
              )}
              <Pagination.Item>
                <Pagination.Next isDisabled={isLast} onPress={() => setPage(currentPage + 1)}>
                  Next
                  <Pagination.NextIcon />
                </Pagination.Next>
              </Pagination.Item>
            </Pagination.Content>
          </Pagination>
        </Table.Footer>
      </Table>
    </div>
  )
}

function ModalDemo() {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <>
      <UiButton onPress={() => setIsOpen(true)}>Open modal</UiButton>
      <UiModal
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        title='Confirm action'
        footer={
          <div className='flex justify-end gap-2'>
            <UiButton variant='ghost' onPress={() => setIsOpen(false)}>
              Cancel
            </UiButton>
            <UiButton onPress={() => setIsOpen(false)}>Confirm</UiButton>
          </div>
        }
      >
        <p>Modal body. Uses overlay surface and shadow tokens from Figma.</p>
      </UiModal>
    </>
  )
}

export default function DesignSystemPage() {
  const [asset, setAsset] = useState<string | number | null>('btc')
  const [assetSearch, setAssetSearch] = useState<string | number | null>(null)

  return (
    <div className='flex flex-col'>
      <header className='py-8'>
        <p className='text-muted text-xs font-medium tracking-wide uppercase'>Design system</p>
        <h1 className='text-h1 mt-2'>System</h1>
        <p className='text-muted mt-3 max-w-2xl text-base'>
          Tokens and base components extracted from the Figma «Lending UX / System» page.
        </p>
      </header>

      <Section title='Typography' description='Inter for sans, system mono fallback.'>
        <div className='flex flex-col gap-3'>
          {TYPOGRAPHY.map(t => (
            <div
              key={t.name}
              className='border-separator flex items-baseline justify-between gap-6 border-b pb-3 last:border-b-0'
            >
              <span className={t.className}>{t.name} — The quick brown fox jumps</span>
              <span className='text-muted shrink-0 font-mono text-xs'>{t.meta}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title='Colors'
        description='Semantic families. HeroUI derives hover/soft via color-mix.'
      >
        <div className='flex flex-col gap-10'>
          {COLOR_FAMILIES.map(family => (
            <div key={family.name}>
              <h3 className='text-h4'>{family.name}</h3>
              <p className='text-muted mt-1 text-sm'>{family.description}</p>
              <div className='mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'>
                {family.swatches.map(s => (
                  <SwatchTile key={s.label} {...s} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title='Radii' description='Derived from `--radius: 0.75rem` (12px).'>
        <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
          {RADII.map(r => (
            <div key={r.label} className='border-border bg-surface flex flex-col gap-2 border p-3'>
              <div className={`bg-default h-12 ${r.className}`} />
              <div className='flex items-baseline justify-between'>
                <span className='text-sm font-medium'>{r.label}</span>
                <span className='text-muted font-mono text-xs'>{r.value}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title='Shadows' description='Field, surface (elevated card) and overlay (modals).'>
        <div className='grid grid-cols-1 gap-6 sm:grid-cols-3'>
          {SHADOWS.map(s => (
            <div
              key={s.label}
              className={`bg-surface flex h-24 items-center justify-center rounded-lg ${s.className}`}
            >
              <span className='font-mono text-xs'>{s.label}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title='Button' description='Variants, sizes, states.'>
        <Row label='Variants'>
          {BUTTON_VARIANTS.map(v => (
            <UiButton key={v} variant={v}>
              {v}
            </UiButton>
          ))}
        </Row>
        <Row label='Sizes'>
          {BUTTON_SIZES.map(s => (
            <UiButton key={s} size={s}>
              Size {s}
            </UiButton>
          ))}
        </Row>
        <Row label='States'>
          <UiButton>Default</UiButton>
          <UiButton isPending loadingText='Saving…'>
            Save
          </UiButton>
          <UiButton isDisabled>Disabled</UiButton>
        </Row>
        <Row label='With icons'>
          <UiButton>
            <SearchIcon className='size-4' />
            Search
          </UiButton>
          <UiButton variant='secondary'>
            <PlusIcon className='size-4' />
            Add member
          </UiButton>
          <UiButton variant='ghost'>
            <CoinsIcon className='size-4' />
            Go back
          </UiButton>
          <UiButton variant='danger'>
            <TrashIcon className='size-4' />
            Delete
          </UiButton>
        </Row>
        <Row label='Icon-only'>
          {BUTTON_SIZES.map(s => (
            <UiButton key={s} size={s} isIconOnly aria-label='Add'>
              <PlusIcon className='size-4' />
            </UiButton>
          ))}
        </Row>
      </Section>

      <Section title='Input' description='Label, description, error, leading/trailing content.'>
        <div className='grid max-w-xl grid-cols-1 gap-5'>
          <UiTextField label='Email address' placeholder='name@email.com' />
          <UiTextField
            label='Your name'
            placeholder='Mary'
            description="We'll never share this with anyone else"
            isRequired
          />
          <UiTextField
            label='Your name'
            defaultValue='Mary387'
            errorMessage='Please enter only letters'
          />
          <UiTextField label='Memo' placeholder='Optional' isDisabled defaultValue='locked' />
          <UiTextField
            label='Search'
            placeholder='Search assets'
            startContent={<SearchIcon className='size-4' />}
          />
          <UiTextField
            label='Set a price'
            startContent={<span className='text-muted text-sm'>$</span>}
            endContent={<span className='text-muted text-sm'>USD</span>}
            defaultValue='10'
            description='What customers would pay'
          />
        </div>
      </Section>

      <Section
        title='Select'
        description='Plain dropdown and searchable combo-box share the same API.'
      >
        <div className='grid max-w-xl grid-cols-1 gap-5'>
          <UiSelect
            label='Asset'
            placeholder='Pick an asset'
            options={ASSETS}
            value={asset}
            onChange={key => setAsset(key)}
          />
          <UiCombobox
            label='Asset (searchable)'
            placeholder='Type to filter…'
            defaultItems={ASSETS}
            value={assetSearch}
            onChange={key => setAssetSearch(key)}
          />
          <UiSelect
            label='Asset (error)'
            placeholder='Pick an asset'
            options={ASSETS}
            errorMessage='Please pick an asset.'
          />
          <UiSelect label='Asset (disabled)' placeholder='—' options={ASSETS} isDisabled />
        </div>
      </Section>

      <Section title='Modal' description='Overlay dialog with header, body, footer, close button.'>
        <ModalDemo />
      </Section>

      <Section
        title='Card'
        description='Surface container with shadow, padding and compound parts.'
      >
        <Card className='max-w-md'>
          <Card.Header>
            <Card.Title>Liquid Bitcoin</Card.Title>
            <Card.Description>L-BTC · Liquid sidechain asset</Card.Description>
          </Card.Header>
          <Card.Content>
            <p className='text-display'>1.2345 L-BTC</p>
            <p className='text-muted text-sm'>≈ $68,420</p>
          </Card.Content>
          <Card.Footer>
            <UiButton size='sm'>Supply</UiButton>
          </Card.Footer>
        </Card>
      </Section>

      <Section
        title='Spinner'
        description='Loading indicator. Sizes sm / md / lg / xl; status colors.'
      >
        <div className='flex flex-wrap items-end gap-6'>
          <Spinner size='sm' />
          <Spinner size='md' />
          <Spinner size='lg' />
          <Spinner size='xl' />
          <Spinner color='success' />
          <Spinner color='warning' />
          <Spinner color='danger' />
        </div>
      </Section>

      <Section
        title='Table'
        description='Sortable, selectable rows. Composable with status chips and pagination.'
      >
        <TableDemo />
      </Section>
    </div>
  )
}
