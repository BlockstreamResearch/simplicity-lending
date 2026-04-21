import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { TestHelpRoute } from './TestHelpRoute'
import { ConnectionGate } from './RouteWidgets'

describe('ConnectionGate', () => {
  it('shows the wallet connect prompt while disconnected', () => {
    const html = renderToStaticMarkup(
      <ConnectionGate connected={false}>
        <span>Ready</span>
      </ConnectionGate>
    )

    expect(html).toContain('Connect the wallet to send requests from this page.')
    expect(html).not.toContain('Ready')
  })

  it('renders child content while connected', () => {
    const html = renderToStaticMarkup(
      <ConnectionGate connected>
        <span>Ready</span>
      </ConnectionGate>
    )

    expect(html).toContain('Ready')
  })
})

describe('TestHelpRoute', () => {
  it('renders the documented command order and method notes', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TestHelpRoute />
      </MemoryRouter>
    )

    expect(html).toContain('Wallet ABI test route checklist.')
    expect(html).toContain('Connect the Blockstream wallet.')
    expect(html).toContain('wallet_abi_process_request')
  })
})
