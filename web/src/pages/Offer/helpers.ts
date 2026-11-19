import type { OfferDetails, OfferShort, OfferUtxoType } from '@/api/indexer/schemas'
import {
  AVERAGE_BLOCK_TIME_SECONDS,
  BLOCKS_PER_DAY,
  BLOCKS_PER_HOUR,
  SECONDS_PER_MINUTE,
} from '@/constants/blocks'
import { DISPLAY_LOCALE, formatBlocksDuration } from '@/utils/format'
import { calcInterest, computeProtocolFee } from '@/utils/offers'

const LOAN_TERM_MAX_FRACTION_DIGITS = 2

export function formatBlocksAgo(currentBlockHeight: number, height: number | null): string | null {
  if (height === null || currentBlockHeight === 0) return null
  return `${formatBlocksDuration(currentBlockHeight - height)} ago`
}

export function formatLoanTerm(blocks: number): { value: string; unit: string } {
  const [divisor, unit] =
    blocks >= BLOCKS_PER_DAY
      ? [BLOCKS_PER_DAY, 'Day']
      : blocks >= BLOCKS_PER_HOUR
        ? [BLOCKS_PER_HOUR, 'Hour']
        : [SECONDS_PER_MINUTE / AVERAGE_BLOCK_TIME_SECONDS, 'Minute']
  const amount = blocks / divisor
  return {
    value: amount.toLocaleString(DISPLAY_LOCALE, {
      maximumFractionDigits: LOAN_TERM_MAX_FRACTION_DIGITS,
    }),
    unit: amount === 1 ? unit : `${unit}s`,
  }
}

export function getLoanDurationBlocks(offer: OfferShort): number {
  return offer.loan_expiration_height - offer.created_at_height
}

export function getLenderNetInterest(offer: OfferShort): bigint {
  const interest = calcInterest(offer.principal_amount, offer.interest_rate)
  return interest - computeProtocolFee(interest)
}

export function getLenderPayout(offer: OfferShort): bigint {
  return offer.principal_amount + getLenderNetInterest(offer)
}

export function getRepaidToLender(offer: OfferDetails): bigint {
  const lenderVault = offer.vaults.find(vault => vault.vault_type === 'lender')
  if (lenderVault) return lenderVault.already_supplied
  return offer.withdrawals
    .filter(withdrawal => withdrawal.vault_type === 'lender')
    .reduce((sum, withdrawal) => sum + withdrawal.amount_withdrawn, 0n)
}

export function getLenderVaultBalance(offer: OfferDetails): bigint {
  return offer.vaults.find(vault => vault.vault_type === 'lender')?.amount ?? 0n
}

export function getReturnedCollateral(offer: OfferDetails): bigint {
  return offer.repayments.reduce((sum, repayment) => sum + repayment.collateral_unlocked, 0n)
}

export function getLiquidatedCollateral(offer: OfferDetails): bigint {
  return offer.collateral_amount - getReturnedCollateral(offer)
}

export function getUtxoCreatedHeight(offer: OfferDetails, utxoType: OfferUtxoType): number | null {
  return offer.utxos.find(utxo => utxo.utxo_type === utxoType)?.created_at_height ?? null
}

export function getFullRepaymentHeight(offer: OfferDetails): number | null {
  return offer.repayments.find(repayment => repayment.is_full)?.height ?? null
}
