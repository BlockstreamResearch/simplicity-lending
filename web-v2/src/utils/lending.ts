// Interest in satoshis. bps = basis points (1000 = 10%, 10000 = 100%).
export function calcInterest(principal: bigint, bps: number): bigint {
  return (principal * BigInt(Math.round(bps))) / 10_000n
}

// Display basis points as human-readable percent string: 1000 → "10.00%"
export function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`
}
