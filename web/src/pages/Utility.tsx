import { useMemo, useState } from 'react'
import { useSeedHex } from '../SeedContext'
import { useAccountAddress } from '../hooks/useAccountAddress'
import { EsploraClient } from '../api/esplora'
import { AccountSection } from './Utility/AccountSection'
import { SplitTxBuilder } from './Utility/SplitTxBuilder'

export function Utility({ accountIndex }: { accountIndex: number }) {
  const seedHex = useSeedHex()
  const esplora = useMemo(() => new EsploraClient(), [])
  const {
    address: accountAddress,
    addressInfo,
    utxos,
    loading,
    error,
    refresh,
    refreshing,
  } = useAccountAddress({ seedHex, accountIndex, esplora })

  const [outpointTxid, setOutpointTxid] = useState('')
  const [outpointVout, setOutpointVout] = useState('')

  const handleUtxoSelect = (txid: string, vout: number) => {
    setOutpointTxid(txid)
    setOutpointVout(String(vout))
  }

  return (
    <div>
      <AccountSection
        accountIndex={accountIndex}
        seedHex={seedHex}
        address={accountAddress}
        addressInfo={addressInfo}
        utxos={utxos}
        loading={loading}
        error={error}
        refreshing={refreshing}
        onRefresh={refresh}
        onUtxoSelect={handleUtxoSelect}
      />
      <SplitTxBuilder
        accountIndex={accountIndex}
        accountAddress={accountAddress}
        utxos={utxos}
        esplora={esplora}
        seedHex={seedHex}
        outpointTxid={outpointTxid}
        outpointVout={outpointVout}
        setOutpointTxid={setOutpointTxid}
        setOutpointVout={setOutpointVout}
      />
    </div>
  )
}
