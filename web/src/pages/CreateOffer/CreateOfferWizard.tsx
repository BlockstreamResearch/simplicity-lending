/**
 * 2-step wizard for Create Offer: Issue Utility NFTs → Create PreLock.
 * Prepare is done outside the wizard (Borrower page "Prepare to be a borrower").
 * Steps shown as pills with arrow; step 2 disabled until step 1 done; summary on step 1 when returning.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { EsploraClient } from '../../api/esplora'
import type { ScripthashUtxoEntry } from '../../api/esplora'
import { PostBroadcastModal } from '../../components/PostBroadcastModal'
import { getBroadcastSuccessMessage } from '../../components/broadcastSuccessMessages'
import { IssueUtilityNftsStep } from './IssueUtilityNftsStep'
import { FinalizeOfferStep } from './FinalizeOfferStep'

export type CreateOfferStep = 2 | 3

/** Summary data from step 1 (Issue Utility NFTs) for display when user returns to step 1. */
export interface Step1Summary {
  txid: string
  collateralAmount: string
  principalAmount: string
  feeAmount: string
  loanExpirationTime: string
  interestPercent: string
  toAddress: string
}

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
  /** When set, wizard starts on step 2 (Create offer) with this issuance txid. */
  initialIssuanceTxid?: string | null
  onBroadcastSuccess: () => void | Promise<void>
  onComplete?: () => void
  /** Called when Issue Utility NFTs step succeeds; receives the issuance txid. */
  onIssueUtilityNftsSuccess?: (issuanceTxid: string) => void
  /** When user clicks "Start over" on step 1 summary (clear issuance and close wizard). */
  onStartOver?: () => void
  /** Optional control (e.g. Recover icon) shown in the same row as step pills, right-aligned. */
  recoveryControl?: ReactNode
  /** Optional panel (e.g. recover-by-txid form) shown below the step pills row. */
  recoveryPanel?: ReactNode
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
  initialIssuanceTxid = null,
  onBroadcastSuccess,
  onComplete,
  onIssueUtilityNftsSuccess,
  onStartOver,
  recoveryControl,
  recoveryPanel,
}: CreateOfferWizardProps) {
  const [currentStep, setCurrentStep] = useState<CreateOfferStep>(() =>
    initialIssuanceTxid?.trim() ? 3 : 2
  )
  /** Txid from completing step 1 in this session (null until then). Recovery uses initialIssuanceTxid. */
  const [step1CompletedTxid, setStep1CompletedTxid] = useState<string | null>(null)
  const [step1Summary, setStep1Summary] = useState<Step1Summary | null>(null)
  /** Post-broadcast modal for step 1 (Issue Utility NFTs). When closed, advance to step 3. */
  const [postBroadcastStep1Txid, setPostBroadcastStep1Txid] = useState<string | null>(null)
  /** Post-broadcast modal for step 3 (Finalize offer). When closed, call onSuccess/onComplete. */
  const [postBroadcastStep3Txid, setPostBroadcastStep3Txid] = useState<string | null>(null)

  const effectiveIssuanceTxid = initialIssuanceTxid ?? step1CompletedTxid
  const step1Done = Boolean(effectiveIssuanceTxid?.trim())

  const handleStep1Success = (txid: string, summary: Step1Summary) => {
    setStep1CompletedTxid(txid)
    setStep1Summary(summary)
    void onBroadcastSuccess()
    onIssueUtilityNftsSuccess?.(txid)
    setPostBroadcastStep1Txid(txid)
  }

  const handlePostBroadcastStep1Close = () => {
    setPostBroadcastStep1Txid(null)
    setCurrentStep(3)
  }

  const handlePostBroadcastStep3Close = () => {
    setPostBroadcastStep3Txid(null)
    void onBroadcastSuccess()
    onComplete?.()
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={`rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium transition-colors ${
              currentStep === 2
                ? 'border-indigo-400 bg-indigo-100 text-indigo-800'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
            onClick={() => setCurrentStep(2)}
          >
            1. Issue Utility NFTs
          </button>
          <span className="text-gray-400 py-2" aria-hidden>
            →
          </span>
          <button
            type="button"
            className={`rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium transition-colors ${
              !step1Done
                ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400'
                : currentStep === 3
                  ? 'border-indigo-400 bg-indigo-100 text-indigo-800'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
            onClick={() => step1Done && setCurrentStep(3)}
            disabled={!step1Done}
          >
            2. Finalize offer
          </button>
        </div>
        {recoveryControl != null ? <div className="shrink-0">{recoveryControl}</div> : null}
      </div>
      {recoveryPanel != null ? <div>{recoveryPanel}</div> : null}

      <PostBroadcastModal
        open={postBroadcastStep1Txid != null}
        onClose={handlePostBroadcastStep1Close}
        txid={postBroadcastStep1Txid}
        successMessage={getBroadcastSuccessMessage('issue_utility_nfts')}
        esplora={esplora}
      />

      <PostBroadcastModal
        open={postBroadcastStep3Txid != null}
        onClose={handlePostBroadcastStep3Close}
        txid={postBroadcastStep3Txid}
        successMessage={getBroadcastSuccessMessage('create_offer')}
        esplora={esplora}
      />

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
          step1Summary={step1Summary}
          issuanceTxidForSummary={effectiveIssuanceTxid}
          onSuccess={handleStep1Success}
          onStartOver={onStartOver}
        />
      )}

      {currentStep === 3 && (
        <FinalizeOfferStep
          key={effectiveIssuanceTxid ?? 'step3'}
          accountIndex={accountIndex}
          accountAddress={accountAddress}
          utxos={utxos}
          esplora={esplora}
          seedHex={seedHex}
          issuanceTxid={effectiveIssuanceTxid}
          onSuccess={handlePostBroadcastStep3Close}
          onBroadcastTxid={setPostBroadcastStep3Txid}
        />
      )}
    </div>
  )
}
