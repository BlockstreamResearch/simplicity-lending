import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Two things about signing with a device that nothing else would notice going wrong.
 *
 * The asset registry's contract data has to be in the transaction before the device sees it. Leave
 * it out and the device still signs — it shows an asset hash where it could have shown a name, and
 * every test still passes. So the order is asserted here.
 *
 * And a device waiting for its PIN has to reach the screens as locked rather than as disconnected,
 * because that is the difference between a modal asking for a PIN and a page saying nothing
 * happened.
 */

const withContracts = { name: 'the transaction, with asset names in it' }
const signed = { name: 'the signed transaction' }

const session = {
  isOpen: false,
  syncing: false,
  balances: { total: {}, confirmed: {}, pending: {} },
  receiveAddress: 'tex1qreceive',
  open: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
  addAssetContracts: vi.fn(() => Promise.resolve(withContracts)),
  capabilities: {
    getWollet: () => Promise.resolve({}),
    getBlindedWalletUtxos: () => Promise.resolve([]),
    getReceiveAddress: () => Promise.resolve('tex1qreceive'),
    rescan: () => Promise.resolve(),
    applyBroadcastTransaction: () => {},
  },
}

vi.mock('@/lib/wallet/wolletSession', () => ({ useWolletSession: () => session }))

vi.mock('@/providers/lwk/useLwk', () => ({
  useOptionalLwk: () => ({
    lwkNetwork: {},
    network: 'liquidtestnet',
    isTestnet: true,
    isMainnet: false,
    isRegtest: false,
  }),
}))

const device = {
  status: 'ready' as 'ready' | 'locked',
  descriptorArrives: Promise.resolve({ toString: () => 'ct(slip77(00),elwpkh(x))' }),
  signed: vi.fn((pset: unknown) => pset),
}

vi.mock('@/lib/wallet-core/connector/jade', () => ({
  JadeConnector: class {
    connect() {
      return Promise.resolve()
    }
    disconnect() {
      return Promise.resolve()
    }
    getConnectionStatus() {
      return Promise.resolve(device.status)
    }
    getDescriptor() {
      return Promise.resolve({ id: null, result: device.descriptorArrives })
    }
    signPset(pset: unknown) {
      device.signed(pset)

      return Promise.resolve({ id: null, result: Promise.resolve(signed) })
    }
  },
}))

/*
 * Web Serial, which is how a Jade is reached at all. The adapter decides whether it can be reached
 * when its module is first read, so this stands in before that read rather than inside a test.
 */
Object.defineProperty(navigator, 'serial', {
  configurable: true,
  value: { addEventListener: () => {}, removeEventListener: () => {}, getPorts: () => [] },
})

const { useJadeWallet } = await import('@/lib/wallet/jade/adapter')

beforeEach(() => {
  device.status = 'ready'
  device.descriptorArrives = Promise.resolve({ toString: () => 'ct(slip77(00),elwpkh(x))' })
  session.addAssetContracts.mockClear()
  device.signed.mockClear()
})

describe('signing with a device', () => {
  it('puts the asset registry’s contract data in before the device is asked to sign', async () => {
    const { result } = renderHook(() => useJadeWallet())

    await act(async () => {
      await result.current.connect()
    })

    const answer = await result.current.capabilities.signPset!({} as never)

    expect(session.addAssetContracts).toHaveBeenCalled()
    // What the device signed is what came back from that stage, not what went into it.
    expect(device.signed).toHaveBeenCalledWith(withContracts)
    expect(answer).toBe(signed)
  })

  it('stops saying a device is plugged in once the session is given up', async () => {
    const { result } = renderHook(() => useJadeWallet())

    await act(async () => {
      await result.current.connect()
    })

    expect(result.current.usbDeviceDetected).toBe(true)

    await act(async () => {
      await result.current.disconnect()
    })

    // The port's listeners come off with the session, so nothing would clear this afterwards, and
    // the unlock modal branches on it.
    expect(result.current.usbDeviceDetected).toBe(false)
  })

  it('reaches the screens as locked while the device waits for its PIN', async () => {
    device.status = 'locked'
    // The descriptor is what blocks on the PIN, so it never arrives while the device is locked.
    device.descriptorArrives = new Promise(() => {})

    const { result } = renderHook(() => useJadeWallet())

    act(() => {
      void result.current.connect().catch(() => {})
    })

    await waitFor(() => expect(result.current.state).toBe('locked'))
  })
})
