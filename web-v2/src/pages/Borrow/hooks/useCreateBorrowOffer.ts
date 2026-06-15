import { useCallback } from 'react'

import { NETWORK_CONFIG } from '@/constants/network-config'
import { useBorrowerAccount } from '@/hooks/useBorrowerAccount'
import {
  type CreateOfferParams,
  type CreateOfferResult,
  useCreateOffer,
} from '@/hooks/useCreateOffer'

export interface CreateBorrowOfferInput {
  collateralOutpoint: string
  collateralAmount: bigint
  principalAmount: bigint
  principalInterestRate: number
  loanDurationBlocks: number
}

export interface CreateBorrowOffer {
  submit: (input: CreateBorrowOfferInput) => Promise<CreateOfferResult>
}

export function useCreateBorrowOffer(): CreateBorrowOffer {
  const { createOffer } = useCreateOffer()
  const { restore, save } = useBorrowerAccount()

  const submit = useCallback(
    async (input: CreateBorrowOfferInput): Promise<CreateOfferResult> => {
      const refs = restore()
      const params: CreateOfferParams = {
        factoryAuthOutpoint: refs.factoryAuthOutpoint,
        issuanceFactoryOutpoint: refs.issuanceFactoryOutpoint,
        factoryAssetId: refs.factoryAssetId,
        collateralOutpoint: input.collateralOutpoint,
        collateralAmount: input.collateralAmount,
        principalAssetId: NETWORK_CONFIG.principalAsset.id,
        principalAmount: input.principalAmount,
        principalInterestRate: input.principalInterestRate,
        loanDurationBlocks: input.loanDurationBlocks,
        protocolFeeKeeperAssetId: NETWORK_CONFIG.principalAsset.id,
      }
      const result = await createOffer(params)
      save({
        factoryAssetId: refs.factoryAssetId,
        factoryAuthOutpoint: result.factoryAuthOutpoint,
        issuanceFactoryOutpoint: result.issuanceFactoryOutpoint,
      })
      return result
    },
    [restore, save, createOffer],
  )

  return { submit }
}
