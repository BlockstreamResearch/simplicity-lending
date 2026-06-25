import { Popover } from '@heroui/react'

import { type OfferStatus, offerStatusSchema } from '@/api/indexer/schemas'
import CheckIcon from '@/components/icons/CheckIcon'
import ChevronDownIcon from '@/components/icons/ChevronDownIcon'
import { OfferStatusChip } from '@/components/OfferStatusChip'

interface OfferStatusFilterProps {
  value: OfferStatus[]
  onChange: (next: OfferStatus[]) => void
}

export function OfferStatusFilter({ value, onChange }: OfferStatusFilterProps) {
  const toggle = (status: OfferStatus) => {
    onChange(value.includes(status) ? value.filter(s => s !== status) : [...value, status])
  }

  return (
    <Popover.Root>
      <Popover.Trigger className='group inline-flex items-center gap-1 outline-none'>
        Status
        {value.length > 0 && (
          <span className='bg-accent text-accent-foreground flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium'>
            {value.length}
          </span>
        )}
        <ChevronDownIcon className='size-3 transition-transform group-aria-expanded:rotate-180' />
      </Popover.Trigger>
      <Popover.Content className='max-h-none!'>
        <Popover.Dialog className='flex flex-col gap-3 p-4 outline-none'>
          {offerStatusSchema.options.map(status => (
            <StatusOption
              key={status}
              status={status}
              selected={value.includes(status)}
              onToggle={() => toggle(status)}
            />
          ))}
        </Popover.Dialog>
      </Popover.Content>
    </Popover.Root>
  )
}

interface StatusOptionProps {
  status: OfferStatus
  selected: boolean
  onToggle: () => void
}

function StatusOption({ status, selected, onToggle }: StatusOptionProps) {
  return (
    <button type='button' onClick={onToggle} className='flex items-center gap-2 outline-none'>
      <span
        className={`flex size-4 shrink-0 items-center justify-center rounded border ${
          selected ? 'bg-accent text-accent-foreground border-accent' : 'border-muted'
        }`}
      >
        {selected && <CheckIcon className='size-3' />}
      </span>
      <OfferStatusChip status={status} size='md' />
    </button>
  )
}
