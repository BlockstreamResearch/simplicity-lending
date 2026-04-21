import type { LwkTxOut } from '../simplicity'
import { getLwk } from '../simplicity'

export interface WalletAbiParsedOutput {
  index: number
  assetId: string | null
  amountSat: bigint | null
  scriptHex: string
}

export async function parseExplicitOutputsFromTxHex(txHex: string): Promise<WalletAbiParsedOutput[]> {
  const lwk = await getLwk()
  const transaction = lwk.Transaction.fromString(txHex)

  return transaction.outputs.map((output: LwkTxOut, index: number) => ({
    index,
    assetId: output.asset()?.toString() ?? null,
    amountSat: output.value() ?? null,
    scriptHex: output.scriptPubkey().toString(),
  }))
}
