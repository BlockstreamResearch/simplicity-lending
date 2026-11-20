import { z as zod } from 'zod'

import { NETWORK_CONFIG } from '@/constants/network-config'
import { toBigintAmount } from '@/utils/bigint'
import { DECIMAL_AMOUNT_RE } from '@/utils/format'

const PRINCIPAL_AMOUNT_RE = new RegExp(
  `^\\d+(\\.\\d{1,${NETWORK_CONFIG.principalAsset.decimals}})?$`,
)

export const principalAmountSchema = zod
  .string()
  .trim()
  .min(1, 'Enter an amount')
  .regex(DECIMAL_AMOUNT_RE, 'Enter a valid amount')
  .regex(PRINCIPAL_AMOUNT_RE, `Use up to ${NETWORK_CONFIG.principalAsset.decimals} decimal places`)
  .transform(value => toBigintAmount(value, NETWORK_CONFIG.principalAsset.decimals))
