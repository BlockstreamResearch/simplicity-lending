/**
 * The one place the facade reaches the chain library.
 *
 * Nothing above the facade may touch it, and the facade needs two things from it: the address
 * an approved descriptor hands out, and the script that address pays to — which is how every
 * read in this dapp identifies an account. The load is dynamic so a page that never connects a
 * wallet never pays for the module.
 */

import { env } from '@/constants/env'

type Lwk = typeof import('@lilbonekit/lwk-web')

let loading: Promise<Lwk> | null = null

function loadLwk(): Promise<Lwk> {
  loading ??= import('@lilbonekit/lwk-web').then(async lwk => {
    if (typeof lwk.default === 'function') await lwk.default()

    return lwk
  })

  return loading
}

/** The script an address pays to, hex-encoded. */
export async function scriptPubkeyForAddress(address: string): Promise<string> {
  const { Address } = await loadLwk()
  const parsed = new Address(address)

  try {
    const script = parsed.scriptPubkey()

    try {
      return script.toString()
    } finally {
      script.free()
    }
  } finally {
    parsed.free()
  }
}

/**
 * A blinding key that blinds nothing, used only so the chain library will parse a descriptor.
 *
 * The library refuses a Liquid descriptor that carries no blinding key — "Not a CT Descriptor" —
 * and the wallet will not hand one out, deliberately: a descriptor carrying the real key would
 * let this page unblind every output the account holds, which is why the wallet marks every
 * descriptor it serves as unable to. So the descriptor is wrapped in this one to be read at all.
 *
 * A script does not depend on the blinding key. An address does. That is the whole reason this
 * is safe for one and useless for the other, and why nothing derived under it is ever presented
 * as an address: it would be a valid-looking address for a key nobody holds, which is the exact
 * shape of failure this project keeps finding.
 */
const NO_BLINDING = '0000000000000000000000000000000000000000000000000000000000000001'

/**
 * The script the account's first handed-out address pays to, from the descriptor it approved.
 *
 * What the wallet publishes as the connected account is an identifier rather than an address:
 * it is what the wallet's own screens and calls name an account by, and it decodes as no address
 * at all. The script comes from the descriptor instead — a separate thing the person approved at
 * connect, which the wallet hands over when asked.
 *
 * Deriving rather than being told is the point. The wallet holds the descriptor and this page
 * holds no key, so a script worked out here is one a person could check against what they
 * approved, rather than a string the wallet asked to be trusted.
 *
 * The first address is what every read is keyed on, because money a contract action can spend
 * sits only at the account's first handed-out address. That limit is recorded in this project's
 * knowledge and is inherited here rather than chosen.
 *
 * No address is returned, and that is not an omission. The wallet serves no descriptor an address
 * can be derived from and no call that returns one, so this dapp has no way to say where a person
 * receives — stated where it is missing rather than filled in with something that would look
 * right.
 */
export async function scriptPubkeyFromDescriptor(descriptor: string): Promise<string> {
  const lwk = await loadLwk()
  const network = env.VITE_NETWORK === 'liquid' ? lwk.Network.mainnet() : lwk.Network.testnet()

  // The wallet hands its descriptor over with its own checksum attached, which covers that
  // descriptor and not the one it is about to sit inside. Left on, it lands in the middle of the
  // wrapper and the library reads it as the checksum of the whole thing and refuses. The wrapper
  // is left unchecksummed instead of being given a computed one, because a checksum this code
  // wrote would check nothing this code did not already assume.
  const inner = descriptor.split('#')[0]
  const parsed = new lwk.WolletDescriptor(`ct(slip77(${NO_BLINDING}),${inner})`)
  const wollet = new lwk.WolletBuilder(network, parsed).build()
  const derived = await wollet.address(0)

  return derived.address().scriptPubkey().toString()
}
