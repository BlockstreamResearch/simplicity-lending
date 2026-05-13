import { useEffect, useState } from 'react'

import { useNetwork } from '@/providers/network/useNetwork'
import type { LwkNetwork } from '@/simplicity/lwk'

interface NetworkInfo {
  label: string
  genesisBlockHash: string
  defaultExplorerUrl: string
  policyAsset: string
}

// EXAMPLE OF LWK USAGE
export default function DashboardPage() {
  const { network, isTestnet, isMainnet, isRegtest, initLwkNetworkInstance } = useNetwork()
  const [info, setInfo] = useState<NetworkInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let net: LwkNetwork | null = null

    initLwkNetworkInstance()
      .then(instance => {
        net = instance
        setInfo({
          label: instance.toString(),
          genesisBlockHash: instance.genesisBlockHash(),
          defaultExplorerUrl: instance.defaultExplorerUrl(),
          policyAsset: instance.policyAsset().toString(),
        })
      })
      .catch(err => setError(String(err)))

    return () => {
      net?.free()
    }
  }, [initLwkNetworkInstance, network])

  return (
    <div className='space-y-2 p-6'>
      <h1 className='text-3xl font-semibold'>Dashboard</h1>
      <p>
        Network: <code>{network}</code>
      </p>
      <p>
        isTestnet: {isTestnet.toString()} / isMainnet: {isMainnet.toString()} / isRegtest:{' '}
        {isRegtest.toString()}
      </p>
      {error && <p className='text-red-500'>{error}</p>}
      {info && (
        <dl className='space-y-1 text-sm'>
          <dt className='font-medium'>LWK label</dt>
          <dd>
            <code>{info.label}</code>
          </dd>
          <dt className='font-medium'>Genesis block hash</dt>
          <dd>
            <code className='break-all'>{info.genesisBlockHash}</code>
          </dd>
          <dt className='font-medium'>Default explorer</dt>
          <dd>
            <code>{info.defaultExplorerUrl}</code>
          </dd>
          <dt className='font-medium'>Policy asset</dt>
          <dd>
            <code className='break-all'>{info.policyAsset}</code>
          </dd>
        </dl>
      )}
    </div>
  )
}
