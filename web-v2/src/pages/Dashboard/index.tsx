import { useLwk } from '@/providers/lwk/useLwk'

// EXAMPLE OF LWK USAGE
export default function DashboardPage() {
  const { network, isTestnet, isMainnet, isRegtest, lwkNetwork } = useLwk()

  const info = lwkNetwork
    ? {
        label: lwkNetwork.toString(),
        genesisBlockHash: lwkNetwork.genesisBlockHash(),
        defaultExplorerUrl: lwkNetwork.defaultExplorerUrl(),
        policyAsset: lwkNetwork.policyAsset().toString(),
      }
    : null

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
