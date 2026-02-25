/**
 * 2-step wizard for Create Offer: Issue Utility NFTs → Create PreLock.
 * Prepare is done outside the wizard (Borrower page "Prepare to be a borrower").
 */

import { useState } from 'react'
import type { EsploraClient } from '../../api/esplora'
import type { ScripthashUtxoEntry } from '../../api/esplora'
import { IssueUtilityNftsStep } from './IssueUtilityNftsStep'
import { CreatePreLockStep } from './CreatePreLockStep'

export type CreateOfferStep = 2 | 3

export interface CreateOfferWizardProps {
  accountIndex: number
  accountAddress: string | null
  utxos: ScripthashUtxoEntry[]
  esplora: EsploraClient
  seedHex: string
  savedPreparedTxid?: string | null
  savedAuxiliaryAssetId?: string | null
  savedPrepareFirstVout?: number
  currentBlockHeight?: number | null
  onBroadcastSuccess: () => void | Promise<void>
  onComplete?: () => void
  /** Called when Issue Utility NFTs step succeeds (e.g. to clear prepare state). */
  onIssueUtilityNftsSuccess?: () => void
}

export function CreateOfferWizard({
  accountIndex,
  accountAddress,
  utxos,
  esplora,
  seedHex,
  savedPreparedTxid = null,
  savedAuxiliaryAssetId = null,
  savedPrepareFirstVout = 0,
  currentBlockHeight = null,
  onBroadcastSuccess,
  onComplete,
  onIssueUtilityNftsSuccess,
}: CreateOfferWizardProps) {
  const [currentStep, setCurrentStep] = useState<CreateOfferStep>(2)
  const [issuanceTxid, setIssuanceTxid] = useState<string | null>(null)

  const canShowStep3 = Boolean(issuanceTxid?.trim())

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          className={`px-3 py-1.5 rounded-md text-sm font-medium ${
            currentStep === 2 ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-gray-700'
          }`}
          onClick={() => setCurrentStep(2)}
        >
          2. Issue Utility NFTs
        </button>
        {canShowStep3 && (
          <button
            type="button"
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${
              currentStep === 3 ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-gray-700'
            }`}
            onClick={() => setCurrentStep(3)}
          >
            3. Create PreLock
          </button>
        )}
      </div>

      {currentStep === 2 && (
        <IssueUtilityNftsStep
          key="step2"
          accountIndex={accountIndex}
          accountAddress={accountAddress}
          utxos={utxos}
          esplora={esplora}
          seedHex={seedHex}
          preparedTxid={savedPreparedTxid}
          storedAuxiliaryAssetId={savedAuxiliaryAssetId}
          prepareFirstVout={savedPrepareFirstVout}
          currentBlockHeight={currentBlockHeight}
          onSuccess={(txid: string) => {
            setIssuanceTxid(txid)
            void onBroadcastSuccess()
            onIssueUtilityNftsSuccess?.()
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
