/**
 * Helpers for P2PK-derived addresses and script conversion.
 */

import { getSource, getLwk, createP2trAddress, type P2pkNetwork } from '../simplicity'
import { bytesToHex } from './hex'

export const P2PK_NETWORK: P2pkNetwork = 'localtest'

export const POLICY_ASSET_ID: Record<P2pkNetwork, string> = {
  mainnet: '6f0279e9ed041c3d710a9f57d0c02928416460c4b722ae3457a11eec381c526d',
  testnet: '144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49',
  localtest: '5ac9f65c0efcc4775e0baec4ec03abdde22473cd3cf33c0419ca290e0751b225',
}

export interface LwkP2pkAddressResult {
  address: string
  internalKeyHex: string
}

export async function getP2pkAddressFromSecret(
  secretKey: Uint8Array,
  network: P2pkNetwork
): Promise<LwkP2pkAddressResult> {
  const lwk = await getLwk()
  const keypair = lwk.Keypair.fromSecretBytes(secretKey)
  const internalKey = keypair.xOnlyPublicKey()
  const internalKeyHex = internalKey.toString()

  const args = new lwk.SimplicityArguments().addValue(
    'PUBLIC_KEY',
    lwk.SimplicityTypedValue.fromU256Hex(internalKeyHex)
  )

  const address = await createP2trAddress({
    source: getSource('p2pk'),
    args,
    internalKey,
    network,
  })

  return { address, internalKeyHex }
}

export async function getP2pkAddressFromPublicKey(
  xOnlyPublicKey: Uint8Array,
  network: P2pkNetwork
): Promise<string> {
  if (xOnlyPublicKey.length !== 32) throw new Error('Expected 32-byte x-only public key')
  const lwk = await getLwk()
  const internalKeyHex = bytesToHex(xOnlyPublicKey)
  const internalKey = lwk.XOnlyPublicKey.fromBytes(xOnlyPublicKey)
  const args = new lwk.SimplicityArguments().addValue(
    'PUBLIC_KEY',
    lwk.SimplicityTypedValue.fromU256Hex(internalKeyHex)
  )

  return createP2trAddress({
    source: getSource('p2pk'),
    args,
    internalKey,
    network,
  })
}

export async function getScriptPubkeyHexFromAddress(address: string): Promise<string> {
  const lwk = await getLwk()
  const addr = new lwk.Address(address)
  const unconf = addr.toUnconfidential()
  return bytesToHex(unconf.scriptPubkey().bytes())
}

export function inferWalletAbiNetworkFromAddress(
  address: string
): 'liquid' | 'testnet-liquid' | 'localtest-liquid' {
  const trimmed = address.trim().toLowerCase()
  if (trimmed.startsWith('lq1') || trimmed.startsWith('ex1')) return 'liquid'
  if (trimmed.startsWith('tlq1') || trimmed.startsWith('tex1')) return 'testnet-liquid'
  if (trimmed.startsWith('el1')) return 'localtest-liquid'
  return 'testnet-liquid'
}

export function walletAbiNetworkToP2pkNetwork(
  network: 'liquid' | 'testnet-liquid' | 'localtest-liquid'
): P2pkNetwork {
  switch (network) {
    case 'liquid':
      return 'mainnet'
    case 'localtest-liquid':
      return 'localtest'
    case 'testnet-liquid':
      return 'testnet'
  }
}
