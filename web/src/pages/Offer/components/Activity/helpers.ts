import type {
  OfferDetails,
  OfferRepayment,
  OfferUtxoType,
  OfferVaultWithdrawal,
} from '@/api/indexer/schemas'
import type { PendingTxKind, PendingTxRecord } from '@/providers/pendingTransactions/types'

import { getLenderVaultBalance, getLiquidatedCollateral } from '../../helpers'

export interface ActivityAmount {
  asset: 'collateral' | 'principal'
  value: bigint
}

interface ActivityEventBase {
  txid: string
  height: number
  amount: ActivityAmount
}

export type OfferActivityEvent =
  | (ActivityEventBase & {
      type: 'created' | 'accepted' | 'principal-claimed' | 'cancelled' | 'liquidated'
    })
  | (ActivityEventBase & {
      type: 'partial-repayment' | 'full-repayment'
      repayment: OfferRepayment
    })
  | (ActivityEventBase & {
      type: 'partial-withdrawal' | 'full-withdrawal'
      withdrawal: OfferVaultWithdrawal
    })

export type OfferActivityType = OfferActivityEvent['type']

export type OfferPendingTxKind = Exclude<PendingTxKind, 'create_borrower_account' | 'create_offer'>

interface PendingActivity {
  txid: string
  kind: OfferPendingTxKind
  amount: ActivityAmount
  isConfirmed: boolean
}

const collateral = (value: bigint): ActivityAmount => ({ asset: 'collateral', value })
const principal = (value: bigint): ActivityAmount => ({ asset: 'principal', value })

const PENDING_AMOUNT: Record<OfferPendingTxKind, (offer: OfferDetails) => ActivityAmount> = {
  cancel_offer: offer => collateral(offer.collateral_amount),
  claim_principal: offer => principal(offer.principal_amount),
  repay_offer: offer => principal(offer.current_debt),
  accept_offer: offer => principal(offer.principal_amount),
  claim_interest: offer => principal(getLenderVaultBalance(offer)),
  liquidate_offer: offer => collateral(offer.collateral_remaining),
}

export function getOfferActivity(offer: OfferDetails): OfferActivityEvent[] {
  const utxosByHeight = [...offer.utxos].sort((a, b) => a.created_at_height - b.created_at_height)
  const findUtxo = (type: OfferUtxoType) => utxosByHeight.find(utxo => utxo.utxo_type === type)
  const accepted = findUtxo('active_offer')
  const borrowerPrincipal = findUtxo('borrower_principal')
  const cancellation = findUtxo('cancellation')
  const liquidation = findUtxo('liquidation')

  const events: OfferActivityEvent[] = [
    {
      type: 'created',
      txid: offer.created_at_txid,
      height: offer.created_at_height,
      amount: collateral(offer.collateral_amount),
    },
  ]

  if (accepted) {
    events.push({
      type: 'accepted',
      txid: accepted.txid,
      height: accepted.created_at_height,
      amount: principal(offer.principal_amount),
    })
  }

  if (borrowerPrincipal?.spent_txid && borrowerPrincipal.spent_at_height !== null) {
    events.push({
      type: 'principal-claimed',
      txid: borrowerPrincipal.spent_txid,
      height: borrowerPrincipal.spent_at_height,
      amount: principal(offer.principal_amount),
    })
  }

  events.push(
    ...[...offer.repayments].reverse().map(
      (repayment): OfferActivityEvent => ({
        type: repayment.is_full ? 'full-repayment' : 'partial-repayment',
        txid: repayment.txid,
        height: repayment.height,
        amount: principal(repayment.amount_repaid),
        repayment,
      }),
    ),
    ...offer.withdrawals
      .filter(withdrawal => withdrawal.vault_type === 'lender')
      .reverse()
      .map(
        (withdrawal): OfferActivityEvent => ({
          type: withdrawal.is_full ? 'full-withdrawal' : 'partial-withdrawal',
          txid: withdrawal.txid,
          height: withdrawal.height,
          amount: principal(withdrawal.amount_withdrawn),
          withdrawal,
        }),
      ),
  )

  if (cancellation) {
    events.push({
      type: 'cancelled',
      txid: cancellation.txid,
      height: cancellation.created_at_height,
      amount: collateral(offer.collateral_amount),
    })
  }

  if (liquidation) {
    events.push({
      type: 'liquidated',
      txid: liquidation.txid,
      height: liquidation.created_at_height,
      amount: collateral(getLiquidatedCollateral(offer)),
    })
  }

  return events.sort((a, b) => a.height - b.height)
}

export function getPendingActivity(
  offer: OfferDetails,
  events: OfferActivityEvent[],
  pendingTxs: PendingTxRecord[],
): PendingActivity[] {
  const indexedTxids = new Set(events.map(event => event.txid))
  return pendingTxs
    .filter(
      (tx): tx is PendingTxRecord & { kind: OfferPendingTxKind } =>
        tx.kind !== 'create_borrower_account' &&
        tx.kind !== 'create_offer' &&
        tx.offerId === offer.id &&
        tx.confirmationStatus !== 'failed' &&
        !indexedTxids.has(tx.txid),
    )
    .map(tx => ({
      txid: tx.txid,
      kind: tx.kind,
      amount: PENDING_AMOUNT[tx.kind](offer),
      isConfirmed: tx.confirmationStatus !== 'processing',
    }))
}
