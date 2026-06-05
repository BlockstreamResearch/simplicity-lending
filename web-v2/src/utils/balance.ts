// Wallet balances arrive as asset id → satoshis string. 0 for missing.
export function getAssetBalance(balances: Record<string, string>, assetId: string): bigint {
  const raw = balances[assetId]
  return raw ? BigInt(raw) : 0n
}
