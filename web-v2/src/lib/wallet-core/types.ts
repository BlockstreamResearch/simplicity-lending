export type SinglesigVariant = 'Wpkh' | 'ShWpkh'

/** Raw JADE_STATE values from getVersion() */
export type JadeConnectionState = 'LOCKED' | 'READY' | 'UNINIT' | 'TEMP'

export type JadeVersionInfo = {
  jadeState: JadeConnectionState
  /** EFUSEMAC — unique hardware identifier */
  jadeMac: string
  jadeVersion: string
}

export type ConnectionStatus = 'disconnected' | 'locked' | 'ready'

export type SavedSession = {
  efuseMac: string | null
  walletType: SinglesigVariant
  descriptorStr: string
}

export type WalletState = {
  connectionStatus: ConnectionStatus
  jadeMac: string | null
  walletType: SinglesigVariant | null
  balances: Record<string, string>
  syncing: boolean
  usbDeviceDetected: boolean
  /** Last error message. Persists even after isError is cleared. */
  error: string | null
  /** Whether the error should be shown to the user. Cleared on reconnect or new connect attempt. */
  isError: boolean
}

export const INITIAL_WALLET_STATE: WalletState = {
  connectionStatus: 'disconnected',
  jadeMac: null,
  walletType: null,
  balances: {},
  syncing: false,
  usbDeviceDetected: false,
  error: null,
  isError: false,
}
