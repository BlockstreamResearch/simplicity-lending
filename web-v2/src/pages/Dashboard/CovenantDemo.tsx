import type { XOnlyPublicKey } from 'lwk_web'
import { useEffect, useMemo, useState } from 'react'
import { sources } from 'virtual:simplicity-sources'

import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import { loadScriptAuthProgram } from '@/simplicity/covenants/scriptAuth'

export default function CovenantDemo() {
  const { lwkNetwork } = useLwk()
  const { connectionStatus, getXOnlyPublicKey } = useWallet()

  const [xOnlyPublicKey, setXOnlyPublicKey] = useState<XOnlyPublicKey | null>(null)

  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (connectionStatus !== 'ready') return
    let cancelled = false
    getXOnlyPublicKey()
      .then(key => {
        if (!cancelled && key) setXOnlyPublicKey(key)
      })
      .catch(err => {
        if (!cancelled) setError(String(err))
      })
    return () => {
      cancelled = true
    }
  }, [connectionStatus, getXOnlyPublicKey])

  const result = useMemo(() => {
    if (!xOnlyPublicKey) {
      return null
    }

    const scriptHash = crypto.getRandomValues(new Uint8Array(32))
    const program = loadScriptAuthProgram(scriptHash)
    const address = program.createP2trAddress(xOnlyPublicKey, lwkNetwork).toString()

    return {
      sourceLoaded: !!sources.script_auth,
      xOnlyPublicKey: xOnlyPublicKey.toString(),
      scriptHash: Array.from(scriptHash),
      address,
      cmr: program.cmr.toString(),
    }
  }, [lwkNetwork, xOnlyPublicKey])

  return (
    <div className='space-y-4'>
      <div className='rounded border border-gray-300 bg-white p-4'>
        <div className='font-bold'>ScriptAuth Covenant Smoke Test</div>

        <pre className='mt-4 rounded bg-gray-100 p-4 text-sm'>
          {JSON.stringify(
            {
              hasPubkey: !!xOnlyPublicKey,
              error,
              result,
            },
            null,
            2,
          )}
        </pre>
      </div>
    </div>
  )
}
