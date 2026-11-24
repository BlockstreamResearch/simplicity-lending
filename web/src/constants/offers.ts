// Liquid ~1 block/minute → 144 blocks ≈ 2.4h.
// Active loans whose term left is under this threshold are "nearing deadline".
export const REPAYMENT_DUE_THRESHOLD_BLOCKS = 144

export const BPS_DIVISOR = 10_000n

export const VAULT_MIN_REMAINDER = 1n

export const MAX_LTV = 0.55

export const MEDIUM_RISK_LTV = MAX_LTV / 3

export const HIGH_RISK_LTV = (MAX_LTV * 2) / 3

export const MAX_LTV_BAR_POSITION = 64

export const VAULT_CHANGED_MESSAGE = 'The vault has just changed. Reopen and try again.'

export const PROTOCOL_FEE_BPS = 1000

export const PROTOCOL_FEE_LABEL = `Protocol Fee (${PROTOCOL_FEE_BPS / 100}%)`

export const PROTOCOL_FEE_TOOLTIP = 'A fixed 10% protocol fee\ndeducted from the lender fee.'

export const APR_TOOLTIP =
  'The annualized rate, based on the fee, loan amount, and term. The protocol fee is not included.'
