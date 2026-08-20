import type { TransactionStep } from '@/providers/txProgress/types'
import type { WalletSignerType } from '@/providers/walletFacade/types'

const STANDARD_STAGE_ORDER = ['constructing', 'signing', 'finalizing', 'broadcasting'] as const

type StandardStage = (typeof STANDARD_STAGE_ORDER)[number]

function getStageLabel(
  stage: StandardStage,
  signerType: WalletSignerType | null,
): { title: string; subtitle: string } {
  switch (stage) {
    case 'constructing':
      return { title: 'Constructing Transaction', subtitle: 'Building inputs and outputs' }
    case 'signing':
      return signerType === 'jade'
        ? { title: 'Sign on Jade', subtitle: 'Confirm the transaction on your device' }
        : { title: 'Signing Transaction', subtitle: 'Authorizing with your wallet' }
    case 'finalizing':
      return { title: 'Finalizing Transaction', subtitle: 'Putting on the finishing touches' }
    case 'broadcasting':
      return { title: 'Broadcasting Transaction', subtitle: 'Submitting to the network' }
  }
}

/** Standard constructing→signing→finalizing→broadcasting steps every flow uses today. */
export function getStandardTransactionSteps(
  signerType: WalletSignerType | null,
): TransactionStep<StandardStage>[] {
  return STANDARD_STAGE_ORDER.map(stage => ({ id: stage, ...getStageLabel(stage, signerType) }))
}

/**
 * The one step an action performed by the wallet has.
 *
 * Building, checking each contract, signing and sending all happen inside the wallet, in one
 * call. Four stages here would be progress this page cannot see: the only two moments it knows
 * are the request leaving and the answer arriving.
 */
export function getWalletActionSteps(): TransactionStep<'approving'>[] {
  return [
    {
      id: 'approving',
      title: 'Check It in Your Wallet',
      subtitle: 'The wallet builds the transaction, checks the contracts and sends it',
    },
  ]
}
