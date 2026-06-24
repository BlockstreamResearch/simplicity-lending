import type { Network } from 'lwk_web'

import type { NetworkName } from '@/constants/env'

export interface LwkContextValue {
  lwkNetwork: Network
  network: NetworkName
  isTestnet: boolean
  isMainnet: boolean
  isRegtest: boolean
}
