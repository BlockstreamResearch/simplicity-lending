import { WalletActionIncompleteError } from '@/lib/wallet/errors'

/**
 * What the wallet answers a performed action with, in the terms this dapp uses it in.
 *
 * The wallet says more than this — what it charged, the transaction it built — and the parts
 * read here are the ones something in this application acts on. The deployment is kept because
 * an action that creates one reports fields the wallet chose the outputs for; nothing outside
 * the wallet could work them out afterwards.
 */
export interface WalletActionOutcome {
  deployment: Record<string, string> | null
  txid: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValues(value: unknown): Record<string, string> | null {
  const record = asRecord(value)

  if (!record) return null

  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

/** Reads the wallet's answer, or refuses by name when there is no transaction in it. */
export function walletActionOutcome(action: string, answer: unknown): WalletActionOutcome {
  const record = asRecord(answer)
  const txid = record?.txid

  if (typeof txid !== 'string' || txid.length === 0) {
    throw new WalletActionIncompleteError(action)
  }

  return { deployment: stringValues(record?.deployment), txid }
}
