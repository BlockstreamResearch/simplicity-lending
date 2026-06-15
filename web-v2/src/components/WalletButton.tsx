import { UiButton } from '@/components/ui/UiButton'
import { DEFAULT_WALLET_TYPE } from '@/lib/wallet-core/types'
import { useWallet } from '@/providers/wallet/useWallet'
import { truncateAddress } from '@/utils/format'

export function WalletButton({ isDisabled }: { isDisabled?: boolean } = {}) {
  const { connectionStatus, receiveAddress, connect, reconnecting } = useWallet()

  if (reconnecting) {
    return (
      <UiButton variant='secondary' isDisabled>
        Reconnecting…
      </UiButton>
    )
  }

  if (connectionStatus === 'ready' && receiveAddress) {
    return <UiButton variant='secondary'>{truncateAddress(receiveAddress)}</UiButton>
  }

  return (
    <UiButton
      variant='primary'
      isDisabled={isDisabled}
      onPress={() => connect(DEFAULT_WALLET_TYPE)}
    >
      Connect Wallet
    </UiButton>
  )
}
