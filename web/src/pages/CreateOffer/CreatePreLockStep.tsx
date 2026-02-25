/**
 * Step 3: Create PreLock covenant. Form + stub for Build (not yet implemented in browser).
 * NFT outpoints from Step 2: same txid, vout 0=Borrower, 1=Lender, 2=First params, 3=Second params.
 */

import { useState, useMemo } from 'react'
import type { EsploraClient } from '../../api/esplora'
import type { ScripthashUtxoEntry } from '../../api/esplora'
import { P2PK_NETWORK, POLICY_ASSET_ID } from '../../utility/addressP2pk'
import { ButtonPrimary, ButtonSecondary } from '../../components/Button'
import { Input } from '../../components/Input'
import { UtxoSelect } from '../../components/UtxoSelect'
import { formClassNames } from '../../components/formClassNames'

export interface CreatePreLockStepProps {
  accountIndex: number
  accountAddress: string | null
  utxos: ScripthashUtxoEntry[]
  esplora: EsploraClient
  seedHex: string
  issuanceTxid: string | null
  onSuccess: () => void
}

/** Order in Issue Utility NFTs tx: vout 0=Borrower, 1=Lender, 2=First params, 3=Second params. */
const NFT_VOUT_ORDER = [
  { label: 'First parameters NFT', vout: 2 },
  { label: 'Second parameters NFT', vout: 3 },
  { label: 'Borrower NFT', vout: 0 },
  { label: 'Lender NFT', vout: 1 },
] as const

export function CreatePreLockStep({ accountAddress, utxos, issuanceTxid }: CreatePreLockStepProps) {
  const [collateralUtxoIndex, setCollateralUtxoIndex] = useState(0)
  const [principalAssetIdHex, setPrincipalAssetIdHex] = useState('')
  const [issuanceTxId, setIssuanceTxId] = useState(() => issuanceTxid ?? '')
  const [feeUtxoIndex, setFeeUtxoIndex] = useState(0)
  const [feeAmount, setFeeAmount] = useState('')
  const [toAddress, setToAddress] = useState(accountAddress ?? '')
  const [stubMessage, setStubMessage] = useState<string | null>(null)

  const nativeUtxos = useMemo(() => {
    const policyId = POLICY_ASSET_ID[P2PK_NETWORK]
    return utxos.filter((u) => !u.asset || u.asset.trim().toLowerCase() === policyId)
  }, [utxos])

  const assetUtxos = useMemo(() => {
    const policyId = POLICY_ASSET_ID[P2PK_NETWORK]
    return utxos.filter((u) => u.asset && u.asset.trim().toLowerCase() !== policyId)
  }, [utxos])

  const handleBuild = () => {
    setStubMessage(
      'PreLock creation is not yet built in the browser. Use the CLI or wait for WASM support.'
    )
  }

  return (
    <section className="min-w-0 max-w-4xl">
      <h3 className="text-lg font-semibold text-gray-900 mb-2">Step 3: Create PreLock</h3>
      <div className="space-y-4 text-sm">
        <div>
          <p className={formClassNames.label}>Collateral UTXO (asset to lock)</p>
          {assetUtxos.length === 0 ? (
            <p className="text-gray-500">No non-LBTC UTXOs. Complete Step 2 to have NFT UTXOs.</p>
          ) : (
            <UtxoSelect
              className="max-w-md"
              utxos={assetUtxos}
              value={String(collateralUtxoIndex)}
              onChange={(v) => setCollateralUtxoIndex(parseInt(v, 10))}
              optionValueType="index"
              labelSuffix="(asset)"
            />
          )}
        </div>

        <div>
          <p className={formClassNames.label}>Principal asset ID (hex, big-endian)</p>
          <Input
            type="text"
            placeholder="e.g. policy asset for LBTC"
            className="w-full max-w-lg font-mono"
            value={principalAssetIdHex}
            onChange={(e) => setPrincipalAssetIdHex(e.target.value)}
          />
        </div>

        <div>
          <p className={formClassNames.label}>Issuance tx id (from Step 2)</p>
          <Input
            type="text"
            placeholder="Txid from Step 2"
            className="w-full max-w-lg font-mono"
            value={issuanceTxId}
            onChange={(e) => setIssuanceTxId(e.target.value)}
          />
          <p className={formClassNames.helper}>
            NFT outpoints: (txid, 0)=Borrower, (txid, 1)=Lender, (txid, 2)=First params, (txid,
            3)=Second params.
          </p>
        </div>

        {NFT_VOUT_ORDER.map(({ label, vout }) => (
          <div key={vout}>
            <p className={formClassNames.label}>
              {label} (vout {vout})
            </p>
            <p className={formClassNames.helper + ' font-mono'}>
              {issuanceTxId ? `${issuanceTxId.slice(0, 20)}…:${vout}` : '—'}
            </p>
          </div>
        ))}

        <div>
          <p className={formClassNames.label}>Fee UTXO (LBTC)</p>
          {nativeUtxos.length === 0 ? (
            <p className="text-gray-500">No LBTC UTXOs.</p>
          ) : (
            <UtxoSelect
              className="max-w-md"
              utxos={nativeUtxos}
              value={String(feeUtxoIndex)}
              onChange={(v) => setFeeUtxoIndex(parseInt(v, 10))}
              optionValueType="index"
              labelSuffix="sats"
            />
          )}
        </div>

        <div>
          <p className={formClassNames.label}>Fee amount (sats)</p>
          <Input
            type="number"
            min={1}
            className="w-28"
            value={feeAmount}
            onChange={(e) => setFeeAmount(e.target.value)}
          />
        </div>

        <div>
          <p className={formClassNames.label}>To address</p>
          <Input
            type="text"
            className="w-full max-w-lg font-mono"
            value={toAddress}
            onChange={(e) => setToAddress(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-2 items-center mt-4">
          <ButtonSecondary size="md" onClick={handleBuild}>
            Build & Sign
          </ButtonSecondary>
          <ButtonPrimary size="md" onClick={handleBuild}>
            Build & Broadcast
          </ButtonPrimary>
        </div>

        {stubMessage && (
          <p className="mt-2 p-3 bg-amber-50 text-amber-800 rounded border border-amber-200">
            {stubMessage}
          </p>
        )}
      </div>
    </section>
  )
}
