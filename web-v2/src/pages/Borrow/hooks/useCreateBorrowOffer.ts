import { useCallback } from 'react'

import { NETWORK_CONFIG } from '@/constants/network-config'
import {
  type CreateOfferParams,
  type CreateOfferResult,
  useCreateOffer,
} from '@/hooks/useCreateOffer'
import { useWallet } from '@/providers/wallet/useWallet'

import { saveBorrowerAccount } from '../borrowerAccountStorage'
import { useBorrowerAccountRefs } from './useBorrowerAccountRefs'

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
  const { resolve } = useBorrowerAccountRefs()
  const { xOnlyPubkey } = useWallet()

  const submit = useCallback(
    async (input: CreateBorrowOfferInput): Promise<CreateOfferResult> => {
      const refs = resolve()
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
      if (xOnlyPubkey) {
        saveBorrowerAccount(xOnlyPubkey, {
          factoryAssetId: refs.factoryAssetId,
          factoryAuthOutpoint: result.factoryAuthOutpoint,
          issuanceFactoryOutpoint: result.issuanceFactoryOutpoint,
        })
      }
      return result
    },
    [resolve, createOffer, xOnlyPubkey],
  )

  return { submit }
}
