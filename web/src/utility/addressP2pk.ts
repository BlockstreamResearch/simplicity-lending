/**
 * P2PK (Simplicity P2TR) address from a secret key.
 * Uses simplicity layer: p2pk covenant source + LWK createP2trAddress.
 */

import { getSource, getLwk, createP2trAddress, type P2pkNetwork } from '../simplicity'

export type { P2pkNetwork }

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
 * Get script_pubkey (hex) for an Elements/Liquid address using LWK.
 * Uses the unconfidential address so the script matches what Esplora indexes
 * (Esplora scripthash is keyed by the revealed P2TR script, not the blinded output).
 */
export async function getScriptPubkeyHexFromAddress(address: string): Promise<string> {
  const lwk = await getLwk()
  const addr = new lwk.Address(address)
  const unconf = addr.toUnconfidential()
  const script = unconf.scriptPubkey()
  const bytes = script.bytes()
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
