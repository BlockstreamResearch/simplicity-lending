import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FEE_RATE_SAT_KVB, EsploraClient, resolveWalletFeeRateSatKvb } from './esplora'

describe('Esplora fee estimates', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('uses the exact target when Esplora returns it', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ 1: 0.25, 6: 0.1 }), { status: 200 })
    )

    const client = new EsploraClient('https://esplora.example')

    await expect(client.getFeeRateSatKvb(1)).resolves.toBe(250)
    expect(fetchMock).toHaveBeenCalledWith('https://esplora.example/fee-estimates', {
      signal: expect.any(AbortSignal),
    })
  })

  it('falls back to the next higher target when the exact one is missing', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ 2: 0.5, 144: 0.1 }), { status: 200 })
    )

    const client = new EsploraClient('https://esplora.example')

    await expect(client.getFeeRateSatKvb(1)).resolves.toBe(500)
  })

  it('uses any available numeric target when no higher target exists', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ 144: 0.2 }), { status: 200 }))

    const client = new EsploraClient('https://esplora.example')

    await expect(client.getFeeRateSatKvb(1008)).resolves.toBe(200)
  })

  it('returns the hardcoded fallback when fee estimates are unusable', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ foo: 'bar' }), { status: 200 }))

    const client = new EsploraClient('https://esplora.example')

    await expect(resolveWalletFeeRateSatKvb(client)).resolves.toBe(DEFAULT_FEE_RATE_SAT_KVB)
  })

  it('returns the hardcoded fallback when the fee request fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))

    const client = new EsploraClient('https://esplora.example')

    await expect(resolveWalletFeeRateSatKvb(client)).resolves.toBe(DEFAULT_FEE_RATE_SAT_KVB)
  })
})
