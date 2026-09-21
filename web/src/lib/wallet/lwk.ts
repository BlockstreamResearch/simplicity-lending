/**
 * The one place the facade reaches the chain library.
 *
 * Nothing above the facade may touch it, and the facade needs two things from it: the address
 * an approved descriptor hands out, and the script that address pays to — which is how every
 * read in this dapp identifies an account. The load is dynamic so a page that never connects a
 * wallet never pays for the module.
 */

import type { WolletDescriptor } from '@lilbonekit/lwk-web'

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
 * and the HUMID extension will not hand one out, deliberately: a descriptor carrying the real key
 * would let this page unblind every output the account holds, which is why the wallet marks every
 * descriptor it serves as unable to. So such a descriptor is wrapped in this one to be read at all.
 *
 * A script does not depend on the blinding key. An address does. That is the whole reason this
 * is safe for one and useless for the other, and why nothing derived under it is ever presented
 * as an address: it would be a valid-looking address for a key nobody holds, which is the exact
 * shape of failure this project keeps finding.
 */
const NO_BLINDING = '0000000000000000000000000000000000000000000000000000000000000001'

/**
 * The same descriptor with its blinding key replaced by one that blinds nothing.
 *
 * A signing wallet's descriptor carries the account's blinding key, and anything holding that key
 * can unblind every output the account owns. The extension refuses to serve one for exactly that
 * reason. A wallet whose key lives in this page has no such protection, so what it publishes is
 * stripped here instead: the facade needs a descriptor only to derive the account's script, and a
 * script does not depend on the blinding key.
 *
 * A descriptor that carries no key is returned as it stands — there is nothing to strip, and the
 * derivation adds this same do-nothing key when it needs one.
 *
 * It refuses rather than passes anything confidential through untouched. The key can be written
 * more than one way — `slip77(<hex>)`, a bare master key, an extended private key — and one wallet
 * here does not choose its own descriptor at all: SideSwap's comes from a relay, so the string is a
 * remote party's. Returning what it could not take a key out of would publish that key with nothing
 * to show it had happened, which is the difference between a stripper that fails closed and one
 * that fails silently.
 */
export function withoutBlindingKey(descriptor: string): string {
  const withoutChecksum = descriptor.split('#')[0] ?? ''

  if (!CONFIDENTIAL.test(withoutChecksum)) return descriptor

  // Everything after the blinding key: the account descriptor itself. No form of the key contains
  // a comma, so the first one separates them.
  const inner = /^ct\([^,]+,(.+)\)$/u.exec(withoutChecksum)?.[1]

  if (inner === undefined) {
    throw new Error(
      'This wallet served a descriptor whose blinding key could not be taken out, so it was not ' +
        'published: handing it on would let this page unblind every output the account holds.',
    )
  }

  return `ct(slip77(${NO_BLINDING}),${inner})`
}

/** How the chain library writes a descriptor that carries a blinding key, in every form of it. */
const CONFIDENTIAL = /^(ct|elip151)\(/u

/**
 * The descriptor as the chain library will read it, whether or not it arrived confidential.
 *
 * Wallets hand over two different things under one name. The extension serves a bare descriptor,
 * which the library refuses until it is wrapped in a blinding key. Every signing connector serves
 * one that already carries its own — `ct(slip77(<key>),elwpkh(…))` — and wrapping that a second
 * time is refused just as flatly, with "Not an elements descriptor".
 *
 * So the library is asked rather than the string guessed at: a descriptor it accepts as it stands
 * is confidential already and is used unchanged, and only one it refuses is wrapped. A descriptor
 * that is simply malformed fails the second attempt too, and is reported with the library's own
 * first complaint attached rather than as a wrapping that went wrong.
 */
function readDescriptor(lwk: Lwk, descriptor: string): WolletDescriptor {
  try {
    return new lwk.WolletDescriptor(descriptor)
  } catch (notConfidential) {
    // The wallet hands its descriptor over with its own checksum attached, which covers that
    // descriptor and not the one it is about to sit inside. Left on, it lands in the middle of the
    // wrapper and the library reads it as the checksum of the whole thing and refuses. The wrapper
    // is left unchecksummed instead of being given a computed one, because a checksum this code
    // wrote would check nothing this code did not already assume.
    const inner = descriptor.split('#')[0]

    try {
      return new lwk.WolletDescriptor(`ct(slip77(${NO_BLINDING}),${inner})`)
    } catch (cause) {
      throw new Error(
        `This descriptor could be read neither as it stands nor with a blinding key added. ` +
          `The chain library said: ${String(notConfidential)}`,
        { cause },
      )
    }
  }
}

/**
 * The script the account's first handed-out address pays to, from the descriptor it approved.
 *
 * What a wallet publishes as the connected account is an identifier rather than an address: it is
 * what the wallet's own screens and calls name an account by, and it decodes as no address at all.
 * The script comes from the descriptor instead — a separate thing the person approved at connect,
 * which the wallet hands over when asked.
 *
 * Deriving rather than being told is the point. The wallet holds the descriptor and this page
 * holds no key, so a script worked out here is one a person could check against what they
 * approved, rather than a string the wallet asked to be trusted.
 *
 * The first address is what every read is keyed on, because money a contract action can spend
 * sits only at the account's first handed-out address. That limit is recorded in this project's
 * knowledge and is inherited here rather than chosen.
 *
 * No address is returned, and that is not an omission. A script is the same whichever blinding key
 * the descriptor carries, so it can be derived from any of them; an address is not, so a wallet
 * that serves no confidential descriptor leaves this dapp no way to say where a person receives.
 * Stated where it is missing rather than filled in with something that would look right.
 */
export async function scriptPubkeyFromDescriptor(descriptor: string): Promise<string> {
  const lwk = await loadLwk()
  const network = env.VITE_NETWORK === 'liquid' ? lwk.Network.mainnet() : lwk.Network.testnet()

  // Every object below holds Rust memory that the browser's collector knows nothing about, so
  // each is given back in the reverse of the order it was taken. This runs again whenever the
  // account changes, and what is not freed here is not freed at all.
  try {
    const parsed = readDescriptor(lwk, descriptor)

    try {
      // The builder is consumed by `build()` — the library takes it and leaves the handle here
      // null, so freeing it afterwards throws "null pointer passed to rust". Verified against the
      // real module rather than assumed.
      const wollet = new lwk.WolletBuilder(network, parsed).build()

      try {
        const derived = wollet.address(0)

        try {
          const address = derived.address()

          try {
            const script = address.scriptPubkey()

            try {
              return script.toString()
            } finally {
              script.free()
            }
          } finally {
            address.free()
          }
        } finally {
          derived.free()
        }
      } finally {
        wollet.free()
      }
    } finally {
      parsed.free()
    }
  } finally {
    network.free()
  }
}
