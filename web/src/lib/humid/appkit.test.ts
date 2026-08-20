import { describe, expect, it } from 'vitest'

/**
 * The connection layer is built when this module is first imported, which puts it outside every
 * error boundary in the application: a throw there does not fail a screen, it fails the page.
 * Nothing ruled that out before this test — the integration had never been run at all.
 */
describe('building the connection layer at import time', () => {
  it('does not throw, so a failure here cannot take the whole page down', async () => {
    const module = await import('@/lib/humid/appkit')

    expect(module.appKit).toBeDefined()
  })

  it('offers the extension as a connector once it has started', async () => {
    const { appKit } = await import('@/lib/humid/appkit')

    await appKit.ready()

    const ids = appKit.getWalletList().wallets.map(wallet => wallet.id)

    expect(ids).toContain('humid')
  })
})
