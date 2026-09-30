import { useQuery } from '@tanstack/react-query'

import { fetchScriptHashUtxo } from '@/api/esplora/methods'
import type { ScriptHashUtxoEntry } from '@/api/esplora/schemas'
import { NETWORK_CONFIG } from '@/constants/network-config'
import type { WalletUtxo } from '@/lib/wallet/types'
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

/** Where an output sits, so the two reads below can be added without counting one twice. */
function outpointOf(utxo: { txid: string; vout: number }): string {
  return `${utxo.txid}:${utxo.vout}`
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
 * The same total over what the wallet says it holds, confirmed only.
 *
 * `spendable` is the wallet's own word for confirmed: an action is funded from outputs that
 * already exist on the chain, because what is signed has to be valid the moment it is sent.
 */
export function walletSpendableTotal(utxos: readonly WalletUtxo[]): bigint {
  return utxos
    .filter(utxo => utxo.spendable)
    .reduce((total, utxo) => total + BigInt(utxo.amount), 0n)
}

/**
 * The money a contract action can be funded from, which is two reads rather than one.
 *
 * The wallet funds an action from every output it holds in the asset, the blinded ones included:
 * it knows what its own money unblinds to and hands the signing module the secrets, which is the
 * thing a wallet has and a page does not. So what the wallet reports is the larger part of this,
 * and asking it is the only way to count a blinded output at all, because the amount is not in the
 * open on the chain.
 *
 * The chain read stays for the one output the wallet's own list leaves out: an unblinded output at
 * the account's first address. The chain library treats an explicit output at a confidential
 * wallet script as external and omits it, while the wallet's action funding reads those separately
 * and spends them. They are counted here from the chain, at that one address, and added by
 * outpoint so an output both reads return is counted once.
 */
export function useContractFunding(enabled: boolean): ContractFunding {
  const { account, getUtxos, scriptPubkey } = useWallet()
  const collateralAssetId = NETWORK_CONFIG.collateralAsset.id

  const { data, error, isError, isLoading } = useQuery({
    queryKey: ['contract-funding', account, scriptPubkey, collateralAssetId],
    enabled: enabled && scriptPubkey !== null,
    staleTime: 0,
    queryFn: async (): Promise<bigint> => {
      const [held, onChain] = await Promise.all([
        getUtxos(collateralAssetId),
        fetchScriptHashUtxo(await scriptHashOf(scriptPubkey ?? '')),
      ])

      const counted = new Set(held.filter(utxo => utxo.spendable).map(outpointOf))

      return (
        walletSpendableTotal(held) +
        contractSpendableTotal(onChain.filter(utxo => !counted.has(outpointOf(utxo))))
      )
    },
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
