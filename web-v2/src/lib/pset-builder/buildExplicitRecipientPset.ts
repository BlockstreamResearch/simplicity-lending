import { Address, type Network, type OutPoint, type Pset, TxBuilder, type Wollet } from 'lwk_web'

interface BuildExplicitRecipientPsetParams {
  wollet: Wollet
  network: Network
  recipientAddress: string
  outpoints: OutPoint[]
  satoshi: bigint
  feeRate?: number
}

export function buildExplicitRecipientPset({
  wollet,
  network,
  recipientAddress,
  outpoints,
  satoshi,
  feeRate = 1,
}: BuildExplicitRecipientPsetParams): Pset {
  const address = new Address(recipientAddress)

  return new TxBuilder(network)
    .feeRate(feeRate)
    .setWalletUtxos(outpoints)
    .addExplicitRecipient(address, satoshi, network.policyAsset())
    .finish(wollet)
}
