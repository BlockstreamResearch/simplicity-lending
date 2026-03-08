import type { TxCreateResponse } from 'wallet-abi-sdk-alpha/schema'

export interface WalletAbiSuccess {
  txid: string
  txHex: string
}

export function requireWalletAbiSuccess(response: TxCreateResponse): WalletAbiSuccess {
  if (response.status === 'error') {
    throw new Error(response.error.message)
  }
  return {
    txid: response.transaction.txid,
    txHex: response.transaction.tx_hex,
  }
}
