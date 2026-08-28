import { Address } from '@lilbonekit/lwk-web'
import { useState } from 'react'

import { UiButton } from '@/components/ui/UiButton'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import { bytesToHex } from '@/utils/hex'
import { segwitV0ScriptPubkeyToAddress } from '@/utils/segwitAddress'

interface Result {
  scriptPubkeyHex: string
  confidentialAddress: string
  unconfidentialAddress: string
  computedAddress: string
  roundTripScriptPubkeyHex: string
  matches: boolean
}

export default function ScriptToAddressDemo() {
  const { lwkNetwork } = useLwk()
  const { getReceiveAddress } = useWallet()
  const [state, setState] = useState<{
    busy: boolean
    error: string | null
    result: Result | null
  }>({ busy: false, error: null, result: null })

  const run = async () => {
    setState({ busy: true, error: null, result: null })
    try {
      const realAddressString = await getReceiveAddress()
      if (!realAddressString) throw new Error('Missing wallet receive address')

      // The wallet's receive address is confidential (blech32, with an embedded blinding key) —
      // not plain BIP173 bech32. Drop the blinding key first so the HRP and scriptPubkey below
      // both come from the plain unconfidential encoding this demo actually implements.
      const realAddress = Address.parse(realAddressString, lwkNetwork).toUnconfidential()
      const unconfidentialAddressString = realAddress.toString()
      const scriptPubkeyBytes = realAddress.scriptPubkey().bytes()
      const hrp = unconfidentialAddressString.split('1')[0]
      if (!hrp) throw new Error('Could not read the bech32 HRP from the receive address')

      const computedAddress = segwitV0ScriptPubkeyToAddress(scriptPubkeyBytes, hrp)
      // Address.parse(s, network) rejects any non-blinded address outright (lwk_common's
      // policy, not a syntax check) — the bare constructor parses any valid address string
      // without that confidentiality requirement, which is what a round-trip check needs here.
      const roundTripScriptPubkeyBytes = new Address(computedAddress).scriptPubkey().bytes()

      const scriptPubkeyHex = bytesToHex(scriptPubkeyBytes)
      const roundTripScriptPubkeyHex = bytesToHex(roundTripScriptPubkeyBytes)

      setState({
        busy: false,
        error: null,
        result: {
          scriptPubkeyHex,
          confidentialAddress: realAddressString,
          unconfidentialAddress: unconfidentialAddressString,
          computedAddress,
          roundTripScriptPubkeyHex,
          matches: scriptPubkeyHex === roundTripScriptPubkeyHex,
        },
      })
    } catch (err) {
      setState({
        busy: false,
        error: err instanceof Error ? err.message : String(err),
        result: null,
      })
    }
  }

  return (
    <div className='rounded border border-gray-300 bg-white p-4'>
      <div className='font-bold'>Script → Address Demo</div>
      <p className='mt-2 max-w-3xl text-sm text-gray-600'>
        Takes the connected wallet&apos;s own receive address, throws away everything but its
        scriptPubkey, re-derives a bech32 address from just that (no wallet, no derivation path —
        pure BIP173 encoding), then feeds the result back through LWK&apos;s own address parser to
        confirm it resolves to the exact same scriptPubkey bytes.
      </p>

      <div className='mt-4'>
        <UiButton isPending={state.busy} loadingText='Checking...' onPress={() => void run()}>
          Run check
        </UiButton>
      </div>

      {state.error ? <p className='mt-3 text-xs text-red-500'>{state.error}</p> : null}

      {state.result ? (
        <div className='mt-4 flex flex-col gap-2 text-sm'>
          <div>
            <span className='font-semibold'>Wallet&apos;s confidential address: </span>
            <span className='break-all'>{state.result.confidentialAddress}</span>
          </div>
          <div>
            <span className='font-semibold'>Unconfidential (blinding key dropped): </span>
            <span className='break-all'>{state.result.unconfidentialAddress}</span>
          </div>
          <div>
            <span className='font-semibold'>scriptPubkey: </span>
            <span className='break-all font-mono text-xs'>{state.result.scriptPubkeyHex}</span>
          </div>
          <div>
            <span className='font-semibold'>Computed address (hand-rolled bech32): </span>
            <span className='break-all'>{state.result.computedAddress}</span>
          </div>
          <div>
            <span className='font-semibold'>Round-tripped scriptPubkey (via LWK parse): </span>
            <span className='break-all font-mono text-xs'>
              {state.result.roundTripScriptPubkeyHex}
            </span>
          </div>
          <div
            className={`mt-1 font-bold ${state.result.matches ? 'text-green-600' : 'text-red-600'}`}
          >
            {state.result.matches ? '✓ Matches' : '✗ Does not match'}
          </div>
        </div>
      ) : null}
    </div>
  )
}
