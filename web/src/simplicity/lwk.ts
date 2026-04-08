/**
 * LWK (Liquid Wallet Kit) integration for Simplicity programs.
 * Only the address / serialization helpers are still used by the Wallet ABI web flow.
 */

let lwkInit: Promise<typeof import('wallet-abi-sdk-alpha/vendor')> | null = null

export async function getLwk(): Promise<typeof import('wallet-abi-sdk-alpha/vendor')> {
  if (!lwkInit) {
    lwkInit = (async () => {
      const lwk = await import('wallet-abi-sdk-alpha/vendor')
      if (typeof lwk.default === 'function') await lwk.default()
      return lwk
    })()
  }
  return lwkInit
}

export type P2pkNetwork = 'mainnet' | 'testnet' | 'localtest'

export type Lwk = Awaited<ReturnType<typeof getLwk>>
export type LwkSimplicityArguments = InstanceType<Lwk['SimplicityArguments']>
export type LwkXOnlyPublicKey = ReturnType<Lwk['XOnlyPublicKey']['fromString']>
export type LwkScript = ReturnType<InstanceType<Lwk['Address']>['scriptPubkey']>
export type LwkTxOut = ReturnType<Lwk['TxOut']['fromExplicit']>
export type LwkTxOutArray = LwkTxOut[]
export type LwkSimplicityProgram = ReturnType<Lwk['SimplicityProgram']['load']>
export type LwkSimplicityTypedValue = ReturnType<Lwk['SimplicityTypedValue']['fromU32']>
export type LwkSimplicityWitnessValues = InstanceType<Lwk['SimplicityWitnessValues']>
export type LwkSimplicityType = InstanceType<Lwk['SimplicityType']>
export type LwkKeypair = ReturnType<Lwk['Keypair']['fromSecretBytes']>
export type LwkNetwork = ReturnType<Lwk['Network']['mainnet']>
export type LwkTransaction = ReturnType<InstanceType<Lwk['Pset']>['extractTx']>

export interface PsetWithExtractTx {
  extractTx(): LwkTransaction
}

export interface CreateP2trAddressParams {
  source: string
  args: LwkSimplicityArguments
  internalKey: LwkXOnlyPublicKey
  network: P2pkNetwork
}

function resolveNetwork(lwk: Lwk, network: P2pkNetwork): LwkNetwork {
  switch (network) {
    case 'mainnet':
      return lwk.Network.mainnet()
    case 'localtest':
      return lwk.Network.regtestDefault()
    case 'testnet':
      return lwk.Network.testnet()
  }
}

/**
 * Compile a Simplicity program from source + arguments and create its P2TR address.
 */
export async function createP2trAddress(params: CreateP2trAddressParams): Promise<string> {
  const lwk = await getLwk()
  const program = lwk.SimplicityProgram.load(params.source, params.args)
  const address = program.createP2trAddress(params.internalKey, resolveNetwork(lwk, params.network))
  return address.toString()
}
