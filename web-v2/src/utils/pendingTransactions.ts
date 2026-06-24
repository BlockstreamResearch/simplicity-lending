import type { PendingTxKind, PendingTxRecord } from '@/providers/pendingTransactions/types'

export function getOfferPendingTx(
  offerId: string,
  pendingTxs: PendingTxRecord[],
): PendingTxRecord | null {
  return pendingTxs.find(tx => tx.offerId === offerId && tx.confirmationStatus !== 'failed') ?? null
}

export const PENDING_TX_KIND_LABEL: Record<PendingTxKind, string> = {
  create_borrower_account: 'Create borrower account',
  create_offer: 'Create offer',
  accept_offer: 'Accept offer',
  cancel_offer: 'Cancel offer',
  claim_principal: 'Claim principal',
  repay_offer: 'Repay loan',
  claim_interest: 'Claim repayment',
  liquidate_offer: 'Liquidate offer',
}

export function getConfirmationProgressText(record: PendingTxRecord): string {
  switch (record.confirmationStatus) {
    case 'processing':
      return record.confirmations === null ? 'Broadcasted' : '0/2 confirmations'
    case 'confirmed':
      return '1/2 confirmations'
    case 'finalized':
      return '2/2 confirmed'
    case 'failed':
      return record.errorMessage ?? 'Failed to track transaction'
  }
}
