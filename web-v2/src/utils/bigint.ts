import { DECIMAL_AMOUNT_RE } from '@/utils/format'

export function toBigintAmount(value?: string, decimals = 2): bigint {
  if (!value) return 0n
  const trimmed = value.trim()
  if (!DECIMAL_AMOUNT_RE.test(trimmed)) return 0n
  const [whole, frac = ''] = trimmed.split('.')
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(fracPadded || '0')
}
