/**
 * Step 2: Issue Utility NFTs. Form + stub for Build (not yet implemented in browser).
 */

import { useState, useMemo } from 'react'
import type { EsploraClient } from '../../api/esplora'
import type { ScripthashUtxoEntry } from '../../api/esplora'
import { POLICY_ASSET_ID } from '../../utility/addressP2pk'
import { ButtonPrimary, ButtonSecondary } from '../../components/Button'

export interface IssueUtilityNftsStepProps {
  accountIndex: number
  accountAddress: string | null
  utxos: ScripthashUtxoEntry[]
  esplora: EsploraClient
  seedHex: string
  preparedTxid: string | null
  onSuccess: (txid: string) => void
}

export function IssueUtilityNftsStep({
  accountAddress,
  utxos,
  preparedTxid,
}: IssueUtilityNftsStepProps) {
  const nativeUtxos = useMemo(() => {
    const policyId = POLICY_ASSET_ID['testnet']
    return utxos.filter((u) => !u.asset || u.asset.trim().toLowerCase() === policyId)
  }, [utxos])

  const [prepTxId, setPrepTxId] = useState(() => preparedTxid ?? '')
  const [firstIssuanceUtxoIndex, setFirstIssuanceUtxoIndex] = useState('0')
  const [feeUtxoIndex, setFeeUtxoIndex] = useState(0)
  const [feeAmount, setFeeAmount] = useState('')
  const [toAddress, setToAddress] = useState(accountAddress ?? '')
  const [collateralAmount, setCollateralAmount] = useState('')
  const [principalAmount, setPrincipalAmount] = useState('')
  const [loanExpirationTime, setLoanExpirationTime] = useState('')
  const [principalInterestRate, setPrincipalInterestRate] = useState('')
  const [tokensDecimals, setTokensDecimals] = useState('0')
  const [stubMessage, setStubMessage] = useState<string | null>(null)

  const handleBuild = () => {
    setStubMessage(
      'Issue Utility NFTs transaction is not yet built in the browser. Use the CLI or wait for WASM support.'
    )
  }

  return (
    <section className="min-w-0 max-w-4xl">
      <h3 className="text-lg font-semibold text-gray-900 mb-2">Step 2: Issue Utility NFTs</h3>
      <div className="space-y-4 text-sm">
        <div>
          <p className="font-medium text-gray-700 mb-1">Prep issuance tx id</p>
          <input
            type="text"
            placeholder="Txid from Step 1"
            className="w-full max-w-lg border border-gray-300 rounded px-2 py-1.5 font-mono text-gray-900"
            value={prepTxId}
            onChange={(e) => setPrepTxId(e.target.value)}
          />
        </div>

        <div>
          <p className="font-medium text-gray-700 mb-1">First issuance utxo index</p>
          <input
            type="number"
            min={0}
            className="w-20 border border-gray-300 rounded px-2 py-1.5 text-gray-900"
            value={firstIssuanceUtxoIndex}
            onChange={(e) => setFirstIssuanceUtxoIndex(e.target.value)}
          />
        </div>

        <div>
          <p className="font-medium text-gray-700 mb-1">Fee UTXO (LBTC)</p>
          {nativeUtxos.length === 0 ? (
            <p className="text-gray-500">No LBTC UTXOs.</p>
          ) : (
            <select
              className="border border-gray-300 rounded px-2 py-1.5 text-gray-900 bg-white max-w-md"
              value={feeUtxoIndex}
              onChange={(e) => setFeeUtxoIndex(parseInt(e.target.value, 10))}
            >
              {nativeUtxos.map((u, idx) => (
                <option key={`${u.txid}:${u.vout}`} value={idx}>
                  {u.txid.slice(0, 16)}…:{u.vout} — {u.value ?? '?'} sats
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <p className="font-medium text-gray-700 mb-1">Fee amount (sats)</p>
          <input
            type="number"
            min={1}
            className="w-28 border border-gray-300 rounded px-2 py-1.5 text-gray-900"
            value={feeAmount}
            onChange={(e) => setFeeAmount(e.target.value)}
          />
        </div>

        <div>
          <p className="font-medium text-gray-700 mb-1">To address</p>
          <input
            type="text"
            className="w-full max-w-lg border border-gray-300 rounded px-2 py-1.5 font-mono text-gray-900"
            value={toAddress}
            onChange={(e) => setToAddress(e.target.value)}
          />
        </div>

        <p className="font-medium text-gray-700 mt-4">Offer parameters</p>
        <div className="grid gap-2 max-w-md">
          <div>
            <label className="block text-gray-600">Collateral amount</label>
            <input
              type="number"
              min={0}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-gray-900"
              value={collateralAmount}
              onChange={(e) => setCollateralAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-gray-600">Principal amount</label>
            <input
              type="number"
              min={0}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-gray-900"
              value={principalAmount}
              onChange={(e) => setPrincipalAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-gray-600">Loan expiration (block height)</label>
            <input
              type="number"
              min={0}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-gray-900"
              value={loanExpirationTime}
              onChange={(e) => setLoanExpirationTime(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-gray-600">
              Principal interest rate (basis points, 100% = 10000)
            </label>
            <input
              type="number"
              min={0}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-gray-900"
              value={principalInterestRate}
              onChange={(e) => setPrincipalInterestRate(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-gray-600">Token decimals (0–15)</label>
            <input
              type="number"
              min={0}
              max={15}
              className="w-20 border border-gray-300 rounded px-2 py-1.5 text-gray-900"
              value={tokensDecimals}
              onChange={(e) => setTokensDecimals(e.target.value)}
            />
          </div>
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
