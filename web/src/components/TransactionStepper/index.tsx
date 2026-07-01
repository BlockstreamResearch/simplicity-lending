import { Spinner } from '@heroui/react'

import CheckIcon from '@/components/icons/CheckIcon'
import CircleExclamationIcon from '@/components/icons/CircleExclamationIcon'
import { useTxProgress } from '@/providers/txProgress/useTxProgress'

type StepState = 'done' | 'active' | 'error' | 'pending'

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') {
    return (
      <span className='bg-success/15 text-success flex size-8 shrink-0 items-center justify-center rounded-full'>
        <CheckIcon className='size-4' />
      </span>
    )
  }
  if (state === 'error') {
    return (
      <span className='bg-danger/15 text-danger flex size-8 shrink-0 items-center justify-center rounded-full'>
        <CircleExclamationIcon className='size-4' />
      </span>
    )
  }
  if (state === 'active') {
    return (
      <span className='bg-accent-soft flex size-8 shrink-0 items-center justify-center rounded-full'>
        <Spinner size='sm' />
      </span>
    )
  }
  return (
    <span className='bg-surface-secondary flex size-8 shrink-0 items-center justify-center rounded-full'>
      <span className='bg-separator-secondary size-2 rounded-full' />
    </span>
  )
}

export default function TransactionStepper() {
  const { steps, currentStepId, errorMessage } = useTxProgress()
  const activeIndex = steps.findIndex(step => step.id === currentStepId)

  return (
    <div className='flex flex-col'>
      {steps.map((step, index) => {
        const isCurrent = index === activeIndex
        const state: StepState =
          index < activeIndex
            ? 'done'
            : isCurrent
              ? errorMessage !== null
                ? 'error'
                : 'active'
              : 'pending'
        const isLast = index === steps.length - 1

        return (
          <div key={step.id} className='flex gap-3'>
            <div className='flex flex-col items-center'>
              <StepIcon state={state} />
              {!isLast && <span className='bg-separator my-1 w-px flex-1' />}
            </div>
            <div className={isLast ? '' : 'pb-4'}>
              <p
                className={`flex items-center gap-2 text-sm font-medium ${
                  state === 'pending' ? 'text-muted' : ''
                }`}
              >
                <span>{step.title}</span>
                {state === 'error' && (
                  <span className='bg-danger/15 text-danger rounded px-1.5 py-0.5 text-xs leading-none'>
                    Error
                  </span>
                )}
              </p>
              <p className='text-muted wrap-break-word text-sm'>
                {state === 'error' ? errorMessage : step.subtitle}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
