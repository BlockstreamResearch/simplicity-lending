import type { PendingTxKind, PendingTxRecord } from '@/providers/pendingTransactions/types'

export function getOfferPendingTx(
  offerId: string,
  pendingTxs: PendingTxRecord[],
): PendingTxRecord | null {
  return pendingTxs.find(tx => tx.offerId === offerId && tx.confirmationStatus !== 'failed') ?? null
}

export const PENDING_TX_KIND_LABEL: Record<PendingTxKind, string> = {
  create_borrower_account: 'Creating borrower account',
  create_offer: 'Creating offer',
  accept_offer: 'Accepting offer',
  cancel_offer: 'Cancelling offer',
  claim_principal: 'Claiming principal',
  repay_offer: 'Repaying loan',
  claim_interest: 'Claiming repayment',
  liquidate_offer: 'Liquidating offer',
}

export function getConfirmationProgressText(record: PendingTxRecord): string {
  switch (record.confirmationStatus) {
    case 'broadcasted':
      return record.confirmations === null ? 'Broadcasted' : '0/2 confirmations'
    case 'confirmed':
      return '1/2 confirmations'
    case 'finalized':
      return '2/2 confirmed'
    case 'failed':
      return record.errorMessage ?? 'Failed to track transaction'
  }
}
