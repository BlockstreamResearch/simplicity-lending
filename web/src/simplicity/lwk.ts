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

/** LWK module (return type of getLwk()). Use for typing lwk argument across the app. */
export type Lwk = Awaited<ReturnType<typeof getLwk>>

/** Instance of LWK TxOut (use instead of InstanceType<Lwk['TxOut']> — TxOut has a private constructor). */
export type LwkTxOut = ReturnType<Lwk['TxOut']['fromExplicit']>

/** LWK transaction type (first argument of getSighashAll / return of finalizeTransaction). */
export type LwkTransaction = Parameters<InstanceType<Lwk['SimplicityProgram']>['getSighashAll']>[0]

/** PSET that can yield the unsigned transaction for LWK signing (extractTx). */
export interface PsetWithExtractTx {
  extractTx(): LwkTransaction
}

export interface CreateP2trAddressParams {
  source: string
  args: InstanceType<Lwk['SimplicityArguments']>
  internalKey: InstanceType<Lwk['XOnlyPublicKey']>
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
