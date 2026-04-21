import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'
import { DashboardRoute } from './DashboardRoute'

const useWalletAbiSessionMock = vi.fn()

vi.mock('../walletAbi/session', () => ({
  useWalletAbiSession: () => useWalletAbiSessionMock(),
}))

vi.mock('../components/AccountMenu', () => ({
  AccountMenu: () => <div>account menu</div>,
}))

vi.mock('../api/esplora', () => ({
  EsploraClient: class {
    getLatestBlockHeight() {
      return Promise.resolve(0)
    }
  },
}))

describe('AppShell', () => {
  it('does not expose the internal test route in primary navigation', () => {
    useWalletAbiSessionMock.mockReturnValue({
      status: 'disconnected',
      receiveAddress: null,
      error: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      refreshIdentity: vi.fn(),
    })

    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route path="dashboard" element={<div>dashboard body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )

    expect(html).toContain('Dashboard')
    expect(html).toContain('Borrower')
    expect(html).toContain('Lender')
    expect(html).toContain('Utility')
    expect(html).not.toContain('>Test<')
    expect(html).not.toContain('/test')
  })
})

describe('DashboardRoute', () => {
  it('renders the three order streams and a compact connect prompt while disconnected', () => {
    useWalletAbiSessionMock.mockReturnValue({
      status: 'disconnected',
      receiveAddress: null,
      signingXOnlyPubkey: null,
      error: null,
      connect: vi.fn(),
      refreshIdentity: vi.fn(),
    })

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <DashboardRoute />
      </MemoryRouter>
    )

    expect(html).toContain('Your Borrows')
    expect(html).toContain('Your Supply')
    expect(html).toContain('Pending Market Orders')
    expect(html).toContain('Connect wallet to load your borrower positions.')
    expect(html).not.toContain('/test')
  })
})
