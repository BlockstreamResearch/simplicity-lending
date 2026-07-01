import type { TransactionStep } from '@/providers/txProgress/types'
import type { WalletSignerType } from '@/providers/wallet/types'

const DEFAULT_STAGE_ORDER = ['constructing', 'signing', 'finalizing', 'broadcasting'] as const

type DefaultStage = (typeof DEFAULT_STAGE_ORDER)[number]

function getStageLabel(
  stage: DefaultStage,
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

/** Default constructing→signing→finalizing→broadcasting steps every flow uses today. */
export function getDefaultTransactionSteps(
  signerType: WalletSignerType | null,
): TransactionStep<DefaultStage>[] {
  return DEFAULT_STAGE_ORDER.map(stage => ({ id: stage, ...getStageLabel(stage, signerType) }))
}
