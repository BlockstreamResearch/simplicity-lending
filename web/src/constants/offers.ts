// Liquid ~1 block/minute → 144 blocks ≈ 2.4h.
// Active loans whose term left is under this threshold are "nearing deadline".
export const REPAYMENT_DUE_THRESHOLD_BLOCKS = 144

export const BPS_DIVISOR = 10_000n

export const PROTOCOL_FEE_BPS = 1000

export const PROTOCOL_FEE_LABEL = `Protocol Fee (${PROTOCOL_FEE_BPS / 100}%)`

export const PROTOCOL_FEE_TOOLTIP = 'A fixed 10% protocol fee\ndeducted from the lender fee.'

export const APR_TOOLTIP =
  'APR is calculated on the fee net of the protocol fee:\n(fee - protocol fee) / loan amount.'
