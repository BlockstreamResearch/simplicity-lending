import { Contract, ContractHash, type OutPoint } from '@lilbonekit/lwk-web'

import { UNSPENDABLE_TAPROOT_PUBKEY } from '@/simplicity/taproot'
import { sha256 } from '@/utils/sha256'

/** Protocol assets issued with an ELIP-0100 contract. */
export const AssetKind = {
  Factory: 'factory',
  BorrowerNft: 'borrower-nft',
  LenderNft: 'lender-nft',
} as const

export type AssetKind = (typeof AssetKind)[keyof typeof AssetKind]

/**
 * Per-kind contract naming. Tickers are max 7 chars.
 * Hardware wallets hold tickers in 8-byte buffers incl. NUL (e.g. Jade's sign_tx.c ticker[8]).
 */
const ASSET_KINDS: Record<AssetKind, { nameRole: string; tickerPrefix: string }> = {
  [AssetKind.Factory]: { nameRole: '', tickerPrefix: 'SLF' },
  [AssetKind.BorrowerNft]: { nameRole: ' borrower-nft', tickerPrefix: 'SLB' },
  [AssetKind.LenderNft]: { nameRole: ' lender-nft', tickerPrefix: 'SLL' },
}

/**
 * The ELIP-0100 asset contract committed into the factory asset issuance so its metadata is verifiable against
 * the asset id and registrable in the asset registry.
 *
 * Fully stateless, nothing is supplied by the user or by build configuration, so the backend derives the
 * identical contract with no interaction.
 *
 * The backend is the authority. It re-derives this contract while indexing the creation
 * transaction (`expected_contract` in `crates/indexer/src/indexer/asset_registration.rs`) and
 * only a matching commitment gets registered and a domain proof.
 */
export function buildAssetContract(fundingOutpoint: OutPoint, kind: AssetKind): Contract | null {
  const domain = window.location.hostname.toLowerCase()
  if (!domain.includes('.')) return null

  const { nameRole, tickerPrefix } = ASSET_KINDS[kind]
  const txid = fundingOutpoint.txid().toString()
  try {
    return new Contract(
      domain,
      `02${UNSPENDABLE_TAPROOT_PUBKEY}`,
      `simplicity-lending/v1${nameRole} ${txid}:${fundingOutpoint.vout()}`,
      0,
      `${tickerPrefix}${txid.slice(0, 4)}`,
      0,
    )
  } catch {
    return null
  }
}

/** SHA-256 of the contract's canonical (key-sorted) JSON serialization. */
export async function contractHashOf(contract: Contract): Promise<ContractHash> {
  const digest = await sha256(new TextEncoder().encode(contract.toString()))
  return ContractHash.fromBytes(new Uint8Array(digest))
}

/** The contract's hash, or the all-zero hash when no contract is committed. */
export async function contractHashOrEmpty(contract: Contract | null): Promise<ContractHash> {
  return contract ? contractHashOf(contract) : ContractHash.fromBytes(new Uint8Array(32))
}
