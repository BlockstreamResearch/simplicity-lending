import {
  Address,
  type ExternalUtxo,
  type Network,
  type OutPoint,
  type Pset,
  TxBuilder,
  type Wollet,
} from 'lwk_web'

interface BuildExternalExplicitRecipientPsetParams {
  wollet: Wollet
  network: Network
  recipientAddress: string
  outpoints: OutPoint[]
  externalUtxos: ExternalUtxo[]
  satoshi: bigint
  feeRate?: number
}

export function buildExternalExplicitRecipientPset({
  wollet,
  network,
  recipientAddress,
  outpoints,
  externalUtxos,
  satoshi,
  feeRate = 1,
}: BuildExternalExplicitRecipientPsetParams): Pset {
  const address = new Address(recipientAddress)
  void externalUtxos

  return (
    new TxBuilder(network)
      .feeRate(feeRate)
      .setWalletUtxos(outpoints)
      // .addExternalUtxos(externalUtxos) // TODO: expose TxBuilder.addExternalUtxos() in lwk_web.
      .addExplicitRecipient(address, satoshi, network.policyAsset())
      .finish(wollet)
  )
}
