import type { OfferDetails, OfferShort, OfferUtxoType } from '@/api/indexer/schemas'
import { DISPLAY_LOCALE } from '@/utils/format'
import {
  AVERAGE_BLOCK_TIME_SECONDS,
  BLOCKS_PER_DAY,
  BLOCKS_PER_HOUR,
  calcInterest,
  computeProtocolFee,
} from '@/utils/offers'

const SECONDS_PER_MINUTE = 60
const LOAN_TERM_MAX_FRACTION_DIGITS = 2

interface BlocksDuration {
  days: number
  hours: number
  minutes: number
}

export function splitBlocksDuration(blocks: number): BlocksDuration {
  const safeBlocks = Math.max(0, blocks)
  return {
    days: Math.floor(safeBlocks / BLOCKS_PER_DAY),
    hours: Math.floor((safeBlocks % BLOCKS_PER_DAY) / BLOCKS_PER_HOUR),
    minutes: Math.floor(
      ((safeBlocks % BLOCKS_PER_HOUR) * AVERAGE_BLOCK_TIME_SECONDS) / SECONDS_PER_MINUTE,
    ),
  }
}

export function formatBlocksDuration(blocks: number): string {
  const { days, hours, minutes } = splitBlocksDuration(blocks)
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  return `${minutes}m`
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
