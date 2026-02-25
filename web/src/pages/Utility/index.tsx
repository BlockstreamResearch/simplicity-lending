import { useMemo, useState } from 'react'
import { useSeedHex } from '../../SeedContext'
import { useAccountAddress } from '../../hooks/useAccountAddress'
import { EsploraClient } from '../../api/esplora'
import { AccountSection } from './AccountSection'
import { SplitTxBuilder } from './SplitTxBuilder'
import { SplitAssetTxBuilder } from './SplitAssetTxBuilder'
import { MergeTxBuilder } from './MergeTxBuilder'
import { BurnTxBuilder } from './BurnTxBuilder'
import type { UtilityMode } from './types'
import { UTILITY_MODES } from './types'
import { Select } from '../../components/Select'

export type { UtilityMode }

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

  const [utilityMode, setUtilityMode] = useState<UtilityMode>('split-native')
  const [outpointTxid, setOutpointTxid] = useState('')
  const [outpointVout, setOutpointVout] = useState('')

  const [outpointFeeTxid, setOutpointFeeTxid] = useState('')
  const [outpointFeeVout, setOutpointFeeVout] = useState('')
  const [outpointAssetTxid, setOutpointAssetTxid] = useState('')
  const [outpointAssetVout, setOutpointAssetVout] = useState('')

  const handleUtxoSelect = (txid: string, vout: number, isLbtc?: boolean) => {
    if (utilityMode === 'split-asset') {
      if (isLbtc) {
        setOutpointFeeTxid(txid)
        setOutpointFeeVout(String(vout))
      } else {
        setOutpointAssetTxid(txid)
        setOutpointAssetVout(String(vout))
      }
    } else {
      setOutpointTxid(txid)
      setOutpointVout(String(vout))
    }
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
      <div className="mt-10 mb-2 flex items-center gap-2">
        <label htmlFor="utility-mode" className="text-sm font-medium text-gray-700">
          Action:
        </label>
        <Select
          id="utility-mode"
          value={utilityMode}
          onChange={(e) => setUtilityMode(e.target.value as UtilityMode)}
          options={UTILITY_MODES.map(({ mode, label }) => ({ value: mode, label }))}
          widthFromLongestOption
          maxOptionWidth="20rem"
        />
      </div>
      {utilityMode === 'split-native' && (
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
          onBroadcastSuccess={refresh}
        />
      )}
      {utilityMode === 'split-asset' && (
        <SplitAssetTxBuilder
          accountIndex={accountIndex}
          accountAddress={accountAddress}
          utxos={utxos}
          esplora={esplora}
          seedHex={seedHex}
          outpointFeeTxid={outpointFeeTxid}
          outpointFeeVout={outpointFeeVout}
          setOutpointFeeTxid={setOutpointFeeTxid}
          setOutpointFeeVout={setOutpointFeeVout}
          outpointAssetTxid={outpointAssetTxid}
          outpointAssetVout={outpointAssetVout}
          setOutpointAssetTxid={setOutpointAssetTxid}
          setOutpointAssetVout={setOutpointAssetVout}
          onBroadcastSuccess={refresh}
        />
      )}
      {utilityMode === 'merge' && (
        <MergeTxBuilder
          accountIndex={accountIndex}
          accountAddress={accountAddress}
          utxos={utxos}
          esplora={esplora}
          seedHex={seedHex}
          onBroadcastSuccess={refresh}
        />
      )}
      {utilityMode === 'burn' && (
        <BurnTxBuilder
          accountIndex={accountIndex}
          accountAddress={accountAddress}
          utxos={utxos}
          esplora={esplora}
          seedHex={seedHex}
          onBroadcastSuccess={refresh}
        />
      )}
    </div>
  )
}
