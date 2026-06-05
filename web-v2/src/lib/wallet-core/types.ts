export type WalletType = 'Wpkh' | 'ShWpkh'

/** Default wallet type used when kicking off the connect flow. */
export const DEFAULT_WALLET_TYPE: WalletType = 'Wpkh'

/** Raw JADE_STATE values from getVersion() */
export type JadeConnectionState = 'LOCKED' | 'READY' | 'UNINIT' | 'TEMP'

export interface JadeVersionInfo {
  state: JadeConnectionState
  /** EFUSEMAC — unique hardware identifier */
  efuseMac: string
  version: string
}

export type ConnectionStatus = 'disconnected' | 'locked' | 'ready'
