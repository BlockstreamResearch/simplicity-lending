import { useState } from 'react'

import { fetchOffer } from '@/api/indexer/methods'
import type { OfferDetails } from '@/api/indexer/schemas'
import { UiButton } from '@/components/ui/UiButton'
import { UiTextField } from '@/components/ui/UiTextField'

interface OfferIdAutofillProps {
  onResolve: (offer: OfferDetails) => void
}

export function OfferIdAutofill({ onResolve }: OfferIdAutofillProps) {
  const [offerId, setOfferId] = useState('')
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  })

  const handleAutofill = async () => {
    setState({ busy: true, error: null })

    try {
      const offer = await fetchOffer(offerId.trim())
      onResolve(offer)
      setState({ busy: false, error: null })
    } catch (err) {
      setState({ busy: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div className='mt-4'>
      <div className='flex flex-wrap items-end gap-2'>
        <UiTextField label='Offer id' placeholder='e.g. 1' value={offerId} onChange={setOfferId} />
        <UiButton
          variant='outline'
          isDisabled={!offerId.trim()}
          isPending={state.busy}
          loadingText='Loading...'
          onPress={() => void handleAutofill()}
        >
          Autofill from Indexer
        </UiButton>
      </div>
      {state.error ? <p className='mt-2 text-xs text-red-500'>Autofill: {state.error}</p> : null}
    </div>
  )
}
