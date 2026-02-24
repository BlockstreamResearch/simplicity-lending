/**
 * 3-step wizard for Create Offer: Prepare → Issue Utility NFTs → Create PreLock.
 * Holds preparedTxid and issuanceTxid for passing between steps.
 */

import { useState } from 'react'
import type { EsploraClient } from '../../api/esplora'
import type { ScripthashUtxoEntry } from '../../api/esplora'
import { PrepareStep } from './PrepareStep'
import { IssueUtilityNftsStep } from './IssueUtilityNftsStep'
import { CreatePreLockStep } from './CreatePreLockStep'

export type CreateOfferStep = 1 | 2 | 3

export interface CreateOfferWizardProps {
  accountIndex: number
  accountAddress: string | null
  utxos: ScripthashUtxoEntry[]
  esplora: EsploraClient
  seedHex: string
  savedPreparedTxid?: string | null
  onBroadcastSuccess: () => void | Promise<void>
  onPrepareSuccess?: (txid: string) => void
  onComplete?: () => void
}

export function CreateOfferWizard({
  accountIndex,
  accountAddress,
  utxos,
  esplora,
  seedHex,
  savedPreparedTxid = null,
  onBroadcastSuccess,
  onPrepareSuccess,
  onComplete,
}: CreateOfferWizardProps) {
  const hasSavedTxid = Boolean(savedPreparedTxid?.trim())
  const [currentStep, setCurrentStep] = useState<CreateOfferStep>(hasSavedTxid ? 2 : 1)
  const [preparedTxid, setPreparedTxid] = useState<string | null>(savedPreparedTxid ?? null)
  const [issuanceTxid, setIssuanceTxid] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          className={`px-3 py-1.5 rounded-md text-sm font-medium ${
            currentStep === 1 ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-gray-700'
          }`}
          onClick={() => setCurrentStep(1)}
        >
          1. Prepare 4 UTXOs
        </button>
        <button
          type="button"
          className={`px-3 py-1.5 rounded-md text-sm font-medium ${
            currentStep === 2 ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-gray-700'
          }`}
          onClick={() => setCurrentStep(2)}
        >
          2. Issue Utility NFTs
        </button>
        <button
          type="button"
          className={`px-3 py-1.5 rounded-md text-sm font-medium ${
            currentStep === 3 ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-gray-700'
          }`}
          onClick={() => setCurrentStep(3)}
        >
          3. Create PreLock
        </button>
      </div>

      {currentStep === 1 && (
        <PrepareStep
          accountIndex={accountIndex}
          accountAddress={accountAddress}
          utxos={utxos}
          esplora={esplora}
          seedHex={seedHex}
          onSuccess={(txid: string) => {
            setPreparedTxid(txid)
            onPrepareSuccess?.(txid)
            void onBroadcastSuccess()
          }}
        />
      )}

      {currentStep === 2 && (
        <IssueUtilityNftsStep
          key={preparedTxid ?? 'step2'}
          accountIndex={accountIndex}
          accountAddress={accountAddress}
          utxos={utxos}
          esplora={esplora}
          seedHex={seedHex}
          preparedTxid={preparedTxid}
          onSuccess={(txid: string) => {
            setIssuanceTxid(txid)
            void onBroadcastSuccess()
          }}
        />
      )}

      {currentStep === 3 && (
        <CreatePreLockStep
          key={issuanceTxid ?? 'step3'}
          accountIndex={accountIndex}
          accountAddress={accountAddress}
          utxos={utxos}
          esplora={esplora}
          seedHex={seedHex}
          issuanceTxid={issuanceTxid}
          onSuccess={() => {
            void onBroadcastSuccess()
            onComplete?.()
          }}
        />
      )}
    </div>
  )
}
