import { Mnemonic } from '@lilbonekit/lwk-web'
import { useState } from 'react'

import ArrowsRotateIcon from '@/components/icons/ArrowsRotateIcon'
import { UiButton } from '@/components/ui/UiButton'
import { UiTextField } from '@/components/ui/UiTextField'

const WORD_COUNT = 12

interface MnemonicInputProps {
  onChange: (mnemonic: string) => void
}

export function MnemonicInput({ onChange }: MnemonicInputProps) {
  const [words, setWords] = useState<string[]>(() => Array<string>(WORD_COUNT).fill(''))

  const emit = (next: string[]) => {
    setWords(next)
    onChange(next.join(' ').trim())
  }

  // Pasting the full phrase into a single field distributes it across the remaining slots,
  // starting at whichever word was focused.
  const handleWordChange = (index: number, value: string) => {
    const parts = value.trim().split(/\s+/).filter(Boolean)
    const next = [...words]
    if (parts.length > 1) {
      parts.slice(0, WORD_COUNT - index).forEach((word, offset) => {
        next[index + offset] = word
      })
    } else {
      next[index] = value
    }
    emit(next)
  }

  const handleGenerate = () => {
    const generated = Mnemonic.fromRandom(WORD_COUNT)
    const generatedWords = generated.toString().split(' ')
    generated.free()
    emit(generatedWords)
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='bg-surface-secondary grid grid-cols-2 gap-2 rounded-2xl p-3 sm:grid-cols-3'>
        {words.map((word, index) => (
          <UiTextField
            key={index}
            aria-label={`Word ${index + 1}`}
            value={word}
            onChange={value => handleWordChange(index, value)}
            startContent={
              <span className='bg-surface text-muted flex size-4.5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium tabular-nums'>
                {index + 1}
              </span>
            }
          />
        ))}
      </div>
      <UiButton variant='secondary' fullWidth className='group' onPress={handleGenerate}>
        <ArrowsRotateIcon className='size-4 transition-transform duration-300 group-hover:rotate-180' />
        Generate random
      </UiButton>
    </div>
  )
}
