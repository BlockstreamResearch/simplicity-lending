/**
 * LWK (Liquid Wallet Kit) integration for Simplicity programs.
 * - Initializes wasm once, exposes program creation and P2TR address helpers.
 */

let lwkInit: Promise<typeof import('lwk_web')> | null = null

function getWasmUrl(): string {
  if (import.meta.env.DEV) return '/lwk_wasm_bg.wasm'
  return `${import.meta.env.BASE_URL}assets/lwk_wasm_bg.wasm`
}

export async function getLwk(): Promise<typeof import('lwk_web')> {
  if (!lwkInit) {
    lwkInit = (async () => {
      const lwk = await import('lwk_web')
      if (typeof lwk.default === 'function') await lwk.default(getWasmUrl())
      return lwk
    })()
  }
  return lwkInit
}

export type P2pkNetwork = 'mainnet' | 'testnet'

type LwkModule = Awaited<ReturnType<typeof getLwk>>

export interface CreateP2trAddressParams {
  source: string
  args: InstanceType<LwkModule['SimplicityArguments']>
  internalKey: InstanceType<LwkModule['XOnlyPublicKey']>
  network: P2pkNetwork
}

/**
 * Compile a Simplicity program from source + arguments and create its P2TR address.
 */
export async function createP2trAddress(params: CreateP2trAddressParams): Promise<string> {
  const lwk = await getLwk()
  const { SimplicityProgram, Network } = lwk
  const program = new SimplicityProgram(params.source, params.args)
  const net = params.network === 'mainnet' ? Network.mainnet() : Network.testnet()
  const address = program.createP2trAddress(params.internalKey, net)
  return address.toString()
}
