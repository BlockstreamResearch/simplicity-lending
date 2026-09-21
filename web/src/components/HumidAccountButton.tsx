import HumidIcon from '@/components/icons/HumidIcon'
import { UiButton } from '@/components/ui/UiButton'
import { useWallet } from '@/providers/walletFacade/useWallet'
import { truncateAddress } from '@/utils/format'

/**
 * Which account the dapp is acting as on the humid extension.
 *
 * Renders nothing until one is authorised, so a session nobody has connected leaves the
 * header exactly as it was. Pressing it hands over to the wallet's own account view, which
 * is where an account is inspected and where the approval is given up.
 */
export function HumidAccountButton() {
  const { isReady, account, openAccount } = useWallet()

  if (!isReady || !account) return null

  return (
    <UiButton variant='secondary' onPress={openAccount}>
      <HumidIcon className='size-4' />
      {truncateAddress(account)}
    </UiButton>
  )
}
