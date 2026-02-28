/**
 * Calculate principal + interest. interest = (principal * interest_rate) / 10_000 (basis points).
 * Mirrors crates/contracts/src/sdk/parameters.rs calculate_principal_with_interest.
 */
export function calculatePrincipalWithInterest(
  principalAmount: bigint,
  interestRate: number
): bigint {
  const rate = BigInt(Math.floor(interestRate))
  const interest = (principalAmount * rate) / 10_000n
  return principalAmount + interest
}
