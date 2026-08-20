import { useQuery } from '@tanstack/react-query'

import { fetchScriptHashUtxo } from '@/api/esplora/methods'
import type { ScriptHashUtxoEntry } from '@/api/esplora/schemas'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useWallet } from '@/providers/walletFacade/useWallet'
import { bytesToHex, hexToBytes } from '@/utils/hex'
import { sha256 } from '@/utils/sha256'

/** What this account can actually put behind a contract action, in the collateral asset. */
export interface ContractFunding {
  /** Base units across every output a contract action can spend. */
  available: bigint
  isLoading: boolean
  /** Why it is unknown, when it could not be read. Null while it is known. */
  unavailableReason: string | null
}

/**
 * How Esplora keys a script on its scripthash routes: the plain SHA-256 of the script.
 *
 * Not reversed. Electrum's own scripthash is the reverse of the same digest and the two are easy
 * to confuse, but this endpoint answers the forward one — checked against an address whose
 * transactions are known: the reversed form returns an empty history for a script with twenty-one
 * transactions on it, which reads as an empty account rather than as a wrong key.
 */
export async function scriptHashOf(scriptPubkeyHex: string): Promise<string> {
  return bytesToHex(new Uint8Array(await sha256(hexToBytes(scriptPubkeyHex))))
}

/**
 * The outputs of one chain read that a contract action could actually spend.
 *
 * Separated from the query so the rule can be checked without a network: an amount in the open,
 * in the asset this deployment takes as collateral, already confirmed.
 */
export function contractSpendableTotal(utxos: readonly ScriptHashUtxoEntry[]): bigint {
  return utxos
    .filter(
      utxo =>
        utxo.value !== undefined &&
        utxo.asset?.toLowerCase() === NETWORK_CONFIG.collateralAsset.id.toLowerCase() &&
        utxo.status.confirmed,
    )
    .reduce((total, utxo) => total + BigInt(utxo.value ?? 0), 0n)
}

/**
 * The money a contract action can be funded from, which is not the account's balance.
 *
 * A contract action spends only outputs that hide nothing: unblinding one needs secrets the
 * signing module is never given. On a network that hides by default almost everything an account
 * receives is confidential, so a screen offering the balance as collateral offers an amount the
 * wallet then refuses on, after the person has decided.
 *
 * Read from the chain rather than from the wallet, because the wallet does not serve it: its
 * `getUTXOs` describes the account as the chain library reports it, and that library treats an
 * unblinded output at the wallet's own script as external and omits it. The same outputs are
 * visible to anyone reading the chain, which is what this does — at the one address a contract
 * action can spend from, which is the script this dapp already identifies the account by.
 */
export function useContractFunding(enabled: boolean): ContractFunding {
  const { scriptPubkey } = useWallet()

  const { data, error, isError, isLoading } = useQuery({
    queryKey: ['contract-funding', scriptPubkey, NETWORK_CONFIG.collateralAsset.id],
    enabled: enabled && scriptPubkey !== null,
    staleTime: 0,
    queryFn: async () => fetchScriptHashUtxo(await scriptHashOf(scriptPubkey ?? '')),
    select: contractSpendableTotal,
  })

  return {
    available: data ?? 0n,
    isLoading: enabled && isLoading,
    unavailableReason: isError
      ? `Could not read what this account can put behind a contract action. ${
          error instanceof Error ? error.message : String(error)
        }`
      : null,
  }
}
