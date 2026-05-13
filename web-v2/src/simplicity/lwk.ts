/**
 * LWK (Liquid Wallet Kit) integration for Simplicity programs.
 * - Initializes wasm once, exposes program creation and P2TR address helpers.
 */

let lwkInit: Promise<typeof import('lwk_web')> | null = null

export async function getLwk(): Promise<typeof import('lwk_web')> {
  if (!lwkInit) {
    lwkInit = (async () => {
      const lwk = await import('lwk_web')
      if (typeof lwk.default === 'function') await lwk.default()
      return lwk
    })()
  }
  return lwkInit
}

/** LWK module (return type of getLwk()). Use for typing lwk argument across the app. */
export type Lwk = Awaited<ReturnType<typeof getLwk>>

/** Instance of LWK SimplicityArguments. */
export type LwkSimplicityArguments = InstanceType<Lwk['SimplicityArguments']>

/** Instance of LWK XOnlyPublicKey. */
export type LwkXOnlyPublicKey = ReturnType<Lwk['XOnlyPublicKey']['fromBytes']>

/** Instance of LWK Script. */
export type LwkScript = InstanceType<Lwk['Script']>

/** Instance of LWK TxOut (use instead of InstanceType<Lwk['TxOut']> — TxOut has a private constructor). */
export type LwkTxOut = ReturnType<Lwk['TxOut']['fromExplicit']>

/** Array of LWK TxOut (e.g. for getSighashAll / finalizeTransaction prevouts). */
export type LwkTxOutArray = LwkTxOut[]

/** Instance of LWK SimplicityProgram. */
export type LwkSimplicityProgram = ReturnType<Lwk['SimplicityProgram']['load']>

/** Instance of LWK SimplicityTypedValue. */
export type LwkSimplicityTypedValue = ReturnType<Lwk['SimplicityTypedValue']['fromU8']>

/** Instance of LWK SimplicityWitnessValues. */
export type LwkSimplicityWitnessValues = InstanceType<Lwk['SimplicityWitnessValues']>

/** Instance of LWK SimplicityType (for parsing type strings). */
export type LwkSimplicityType = ReturnType<Lwk['SimplicityType']['u1']>

/** Instance of LWK Keypair. */
export type LwkKeypair = ReturnType<Lwk['Keypair']['fromSecretBytes']>

/** LWK Network (return type of Network.mainnet() / Network.testnet()). */
export type LwkNetwork = ReturnType<Lwk['Network']['mainnet']>

/** LWK transaction type (first argument of getSighashAll / return of finalizeTransaction). */
export type LwkTransaction = ReturnType<Lwk['Transaction']['fromString']>

export type NetworkName = 'liquid' | 'liquidtestnet' | 'regtest'

/** PSET that can yield the unsigned transaction for LWK signing (extractTx). */
export interface PsetWithExtractTx {
  extractTx(): LwkTransaction
}

export interface CreateP2trAddressParams {
  source: string
  args: LwkSimplicityArguments
  internalKey: LwkXOnlyPublicKey
  network: NetworkName
}

/**
 * Compile a Simplicity program from source + arguments and create its P2TR address.
 */
export async function createP2trAddress(params: CreateP2trAddressParams): Promise<string> {
  const lwk = await getLwk()
  const { SimplicityProgram } = lwk
  const program = SimplicityProgram.load(params.source, params.args)
  const net = createLwkNetwork(params.network, lwk)
  const address = program.createP2trAddress(params.internalKey, net)
  return address.toString()
}

export function createLwkNetwork(network: NetworkName, lwk: Lwk): LwkNetwork {
  switch (network) {
    case 'liquid':
      return lwk.Network.mainnet()
    case 'liquidtestnet':
      return lwk.Network.testnet()
    case 'regtest':
      return lwk.Network.regtestDefault()
  }
}
