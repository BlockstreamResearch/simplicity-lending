// Borrower account refs are stored in localStorage (see borrowerAccountStorage.ts) because
// the backend does not yet persist this state. This hook lives next to that storage module
// rather than in src/hooks/ to keep the temporary coupling contained.
// TODO: move to src/hooks/ alongside useBorrowerAccount once the backend exposes account refs.
import { useCallback } from 'react'

import { useWallet } from '@/providers/wallet/useWallet'

import { getBorrowerAccount } from '../borrowerAccountStorage'

export interface BorrowerAccountRefs {
  factoryAssetId: string
  factoryAuthOutpoint: string
  issuanceFactoryOutpoint: string
}

export interface BorrowerAccountRefsState {
  hasAccount: boolean
  resolve: () => BorrowerAccountRefs
}

export function useBorrowerAccountRefs(): BorrowerAccountRefsState {
  const { xOnlyPubkey } = useWallet()
  const stored = xOnlyPubkey ? getBorrowerAccount(xOnlyPubkey) : null

  const resolve = useCallback((): BorrowerAccountRefs => {
    const account = xOnlyPubkey ? getBorrowerAccount(xOnlyPubkey) : null
    if (!account) throw new Error('No borrower account found. Create one first.')
    if (!account.factoryAuthOutpoint) {
      throw new Error('Borrower account is outdated. Please re-create it.')
    }
    return {
      factoryAssetId: account.factoryAssetId,
      factoryAuthOutpoint: account.factoryAuthOutpoint,
      issuanceFactoryOutpoint: account.issuanceFactoryOutpoint,
    }
  }, [xOnlyPubkey])

  return { hasAccount: !!stored?.factoryAuthOutpoint, resolve }
}
