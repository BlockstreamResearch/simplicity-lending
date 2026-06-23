import type { OfferStatus } from '@/api/indexer/schemas'

export type PendingTxKind =
  | 'create_borrower_account'
  | 'create_offer'
  | 'accept_offer'
  | 'cancel_offer'
  | 'claim_principal'
  | 'repay_offer'
  | 'claim_interest'
  | 'liquidate_offer'

export type PendingTxConfirmationStatus = 'processing' | 'confirmed' | 'finalized' | 'failed'

export interface PendingTxRecord {
  txid: string
  kind: PendingTxKind
  walletScriptPubkey: string
  offerId?: string
  previousOfferStatus?: OfferStatus
  expectedOfferStatus?: OfferStatus
  confirmationStatus: PendingTxConfirmationStatus
  confirmations: number | null
  createdAt: number
  updatedAt: number
  /** Set once confirmations first reach the finalized threshold; drives the stuck/failed TTL. */
  finalizedAt?: number
  lastIndexerCheckAt?: number
  errorMessage?: string
}

export interface AddPendingTxInput {
  txid: string
  kind: PendingTxKind
  walletScriptPubkey: string
  offerId?: string
  previousOfferStatus?: OfferStatus
  expectedOfferStatus?: OfferStatus
}

export interface PendingTransactionsContextValue {
  /** Pending tx records scoped to the currently connected wallet. */
  pendingTxs: PendingTxRecord[]
  isLoading: boolean
  addPendingTx: (input: AddPendingTxInput) => Promise<void>
  updatePendingTx: (txid: string, patch: Partial<PendingTxRecord>) => Promise<void>
  removePendingTx: (txid: string) => Promise<void>
  /**
   * Marks a txid as "surfaced": the user closed its transaction modal while still pending, so
   * the bottom-center toast should pick up tracking it. Tracking continues even if a modal that
   * stayed open the whole time never calls this.
   */
  addSurfaceToast: (txid: string) => void
}
