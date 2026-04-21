/**
 * P2PK (Simplicity P2TR) address from a secret key.
 * Uses simplicity layer: p2pk covenant source + LWK createP2trAddress.
 */

import { getSource, getLwk, createP2trAddress, type P2pkNetwork } from '../simplicity'
import { bytesToHex } from './hex'

/** Network used for P2PK (Utility page, split tx). */
export const P2PK_NETWORK: P2pkNetwork = 'testnet'

/** Liquid/Elements policy asset (L-BTC) asset ID per network, hex lowercase. */
export const POLICY_ASSET_ID: Record<P2pkNetwork, string> = {
  mainnet: '6f0279e9ed041c3d710a9f57d0c02928416460c4b722ae3457a11eec381c526d',
  testnet: '144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49',
}

export interface LwkP2pkAddressResult {
  address: string
  internalKeyHex: string
}

/**
 * Get P2TR address for the P2PK Simplicity program and the given secret key (32 bytes).
 */
export async function getP2pkAddressFromSecret(
  secretKey: Uint8Array,
  network: P2pkNetwork
): Promise<LwkP2pkAddressResult> {
  const lwk = await getLwk()
  const Keypair = lwk.Keypair
  const SimplicityArguments = lwk.SimplicityArguments
  const SimplicityTypedValue = lwk.SimplicityTypedValue

  const keypair = new Keypair(secretKey)
  const internalKey = keypair.xOnlyPublicKey()
  const internalKeyHex = internalKey.toHex()

  const args = new SimplicityArguments().addValue(
    'PUBLIC_KEY',
    SimplicityTypedValue.fromU256Hex(internalKeyHex)
  )

  const address = await createP2trAddress({
    source: getSource('p2pk'),
    args,
    internalKey,
    network,
  })

  return { address, internalKeyHex }
}

/**
 * Get P2TR address for the P2PK Simplicity program from x-only public key (32 bytes).
 * Mirrors Rust: get_p2pk_address(&borrower_x_only_public_key, network).
 */
export async function getP2pkAddressFromPublicKey(
  xOnlyPublicKey: Uint8Array,
  network: P2pkNetwork
): Promise<string> {
  if (xOnlyPublicKey.length !== 32) throw new Error('Expected 32-byte x-only public key')
  const lwk = await getLwk()
  const SimplicityArguments = lwk.SimplicityArguments
  const SimplicityTypedValue = lwk.SimplicityTypedValue
  const internalKey = lwk.XOnlyPublicKey.fromBytes(xOnlyPublicKey)
  const internalKeyHex = bytesToHex(xOnlyPublicKey)
  const args = new SimplicityArguments().addValue(
    'PUBLIC_KEY',
    SimplicityTypedValue.fromU256Hex(internalKeyHex)
  )
  return createP2trAddress({
    source: getSource('p2pk'),
    args,
    internalKey,
    network,
  })
}

/**
 * Get script_pubkey (hex) for an Elements/Liquid address using LWK.
 * Uses the unconfidential address so the script matches what Esplora indexes.
 */
export async function getScriptPubkeyHexFromAddress(address: string): Promise<string> {
  const lwk = await getLwk()
  const addr = new lwk.Address(address)
  const unconf = addr.toUnconfidential()
  const script = unconf.scriptPubkey()
  if (!script) {
    throw new Error('Address has no scriptPubkey.')
  }
  return bytesToHex(script.bytes())
}
