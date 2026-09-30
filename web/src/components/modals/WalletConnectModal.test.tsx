import { cleanup, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WalletFacadeValue } from '@/providers/walletFacade/types'

/*
 * The picker is where "which wallets does this dapp have" is answered to a person, and the answer
 * has to be the facade's rather than this file's. A card that greys itself out for a reason about
 * this project - an adapter not written yet - tells someone their wallet is unsupported when it is
 * merely unfinished, which is the failure these cases are here to stop.
 */

const connect = vi.fn(() => Promise.resolve())
const cancelPendingRequest = vi.fn(() => Promise.resolve())

let value: Partial<WalletFacadeValue>

vi.mock('@/providers/walletFacade/useWallet', () => ({
  useWallet: () => value,
}))

const { WalletConnectModal } = await import('./WalletConnectModal')

function choice(overrides: Partial<WalletFacadeValue['wallets'][number]> = {}) {
  return {
    id: 'humid',
    name: 'HUMID Extension',
    isAvailable: true,
    unavailableReason: null,
    requiresRecoveryPhrase: false,
    ...overrides,
  }
}

beforeEach(() => {
  connect.mockClear()
  cancelPendingRequest.mockClear()
  value = {
    connect,
    cancelPendingRequest,
    connectionStatus: 'disconnected',
    wallets: [
      choice(),
      choice({ id: 'jade', name: 'Jade' }),
      choice({ id: 'seed', name: 'Seed phrase', requiresRecoveryPhrase: true }),
      choice({
        id: 'sideswap',
        name: 'SideSwap',
        isAvailable: false,
        unavailableReason: 'This build has no SideSwap relay to reach a wallet through.',
      }),
    ],
    pendingRequest: null,
    isError: false,
    error: null,
  } as Partial<WalletFacadeValue>
})

afterEach(() => {
  cleanup()
})

function open() {
  render(<WalletConnectModal isOpen onOpenChange={() => {}} />)
}

describe('choosing which wallet to act through', () => {
  it('offers every wallet the dapp can act through, by the name each gives itself', () => {
    open()

    expect(screen.getByText('HUMID Extension')).toBeDefined()
    expect(screen.getByText('Jade')).toBeDefined()
    expect(screen.getByText('Seed phrase')).toBeDefined()
    expect(screen.getByText('SideSwap')).toBeDefined()
  })

  it('says why a wallet cannot be picked in that wallet’s own words', () => {
    open()

    expect(
      screen.getByText('This build has no SideSwap relay to reach a wallet through.'),
    ).toBeDefined()
  })

  it('never tells a person a wallet is still being built', () => {
    open()

    expect(document.body.textContent).not.toMatch(/adapter|coming soon|not implemented|yet/i)
  })

  it('asks the wallet the person pressed to connect, and names no other', async () => {
    open()

    await act(async () => {
      screen.getByText('Jade').click()
    })

    expect(connect).toHaveBeenCalledWith('jade', undefined)
  })

  it('asks for a recovery phrase where the wallet says it needs one, rather than connecting', async () => {
    open()

    await act(async () => {
      screen.getByText('Seed phrase').click()
    })

    expect(connect).not.toHaveBeenCalled()
    expect(screen.getByText(/Never enter a real wallet/)).toBeDefined()
  })

  it('shows what a wallet waiting elsewhere is waiting for, and offers to give up on it', async () => {
    value = {
      ...value,
      pendingRequest: { kind: 'login', requestId: 'login-1', appLink: 'liquidconnect://login/' },
    }

    open()

    expect(screen.getByText('liquidconnect://login/')).toBeDefined()

    await act(async () => {
      screen.getByText('Cancel').click()
    })

    expect(cancelPendingRequest).toHaveBeenCalled()
  })
})
