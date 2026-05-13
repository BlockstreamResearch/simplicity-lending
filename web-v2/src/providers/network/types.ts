import type { LwkNetwork, NetworkName } from '@/simplicity/lwk'

export interface NetworkContextValue {
  network: NetworkName
  isTestnet: boolean
  isMainnet: boolean
  isRegtest: boolean
  setNetwork: (network: NetworkName) => void
  initLwkNetworkInstance: () => Promise<LwkNetwork>
}
