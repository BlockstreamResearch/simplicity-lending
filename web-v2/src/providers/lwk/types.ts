import type { Network } from 'lwk_web'

import type { NetworkName } from '@/constants/env'
import type { Lwk } from '@/lwk'

export interface LwkContextValue {
  lwk: Lwk
  lwkNetwork: Network
  network: NetworkName
  isTestnet: boolean
  isMainnet: boolean
  isRegtest: boolean
}
