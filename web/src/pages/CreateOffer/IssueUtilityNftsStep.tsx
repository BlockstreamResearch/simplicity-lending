/**
 * Step 2: Issue Utility NFTs. Builds and signs (or broadcasts) the tx per utility_nfts_issuing.rs.
 * Uses 4 auxiliary UTXOs (from prepare at firstVout..firstVout+3) + 1 fee UTXO; generates fresh issuance entropy.
 */

import { useState, useMemo, useCallback } from 'react'
import type { EsploraClient } from '../../api/esplora'
import type { ScripthashUtxoEntry } from '../../api/esplora'
import { EsploraApiError } from '../../api/esplora'
import { P2PK_NETWORK, POLICY_ASSET_ID } from '../../utility/addressP2pk'
import { parseSeedHex, deriveSecretKeyFromIndex } from '../../utility/seed'
import {
  percentToBasisPoints,
  toBaseAmount,
  encodeFirstNFTParameters,
  encodeSecondNFTParameters,
} from '../../utility/parametersEncoding'
import { buildAndSignIssueUtilityNftsTx } from '../../utility/buildIssueUtilityNftsTx'
import { ButtonPrimary, ButtonSecondary } from '../../components/Button'
import { Input } from '../../components/Input'
import { UtxoSelect } from '../../components/UtxoSelect'
import { formClassNames } from '../../components/formClassNames'
import { InfoTooltip } from '../../components/InfoTooltip'

const ISSUANCE_UTXOS_NEEDED = 4

function prepareVouts(firstVout: number): [number, number, number, number] {
  return [firstVout, firstVout + 1, firstVout + 2, firstVout + 3]
}
const BLOCK_TIME_MINUTES = 1

function formatEndsIn(blockHeight: number, currentHeight: number | null): string {
  if (currentHeight == null) return ''
  const delta = blockHeight - currentHeight
  if (delta <= 0) return 'Already passed or current'
  const totalMinutes = delta * BLOCK_TIME_MINUTES
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  if (days > 0) return `~${days}d ${hours}h`
  if (hours > 0) return `~${hours}h`
  return `~${totalMinutes}m`
}

export interface IssueUtilityNftsStepProps {
  accountIndex: number
  accountAddress: string | null
  utxos: ScripthashUtxoEntry[]
  esplora: EsploraClient
  seedHex: string
  preparedTxid: string | null
  storedAuxiliaryAssetId?: string | null
  prepareFirstVout?: number
  currentBlockHeight?: number | null
  onSuccess: (txid: string) => void
}

export function IssueUtilityNftsStep({
  accountIndex,
  accountAddress,
  utxos,
  esplora,
  seedHex,
  preparedTxid,
  storedAuxiliaryAssetId,
  prepareFirstVout = 0,
  currentBlockHeight = null,
  onSuccess,
}: IssueUtilityNftsStepProps) {
  const prepareVoutList = useMemo(() => prepareVouts(prepareFirstVout), [prepareFirstVout])

  const nativeUtxos = useMemo(() => {
    const policyId = POLICY_ASSET_ID[P2PK_NETWORK]
    return utxos.filter((u) => !u.asset || u.asset.trim().toLowerCase() === policyId)
  }, [utxos])

  const auxiliaryAssetIdNorm = (storedAuxiliaryAssetId ?? '').trim().toLowerCase() || null
  const auxiliaryUtxos = useMemo(() => {
    if (!auxiliaryAssetIdNorm) return []
    return utxos.filter((u) => u.asset && u.asset.trim().toLowerCase() === auxiliaryAssetIdNorm)
  }, [utxos, auxiliaryAssetIdNorm])

  const [manualPrepTxId, setManualPrepTxId] = useState('')
  const effectivePrepTxid = (preparedTxid ?? '').trim() || manualPrepTxId.trim() || null
  const hasAutoFilledPrepTxid = Boolean((preparedTxid ?? '').trim())

  const issuanceUtxosOrdered = useMemo(() => {
    if (!effectivePrepTxid) return null
    const prepTxidLower = effectivePrepTxid.toLowerCase()
    const byVout: Record<number, ScripthashUtxoEntry> = {}
    for (const u of auxiliaryUtxos) {
      if (u.txid.trim().toLowerCase() === prepTxidLower && prepareVoutList.includes(u.vout)) {
        byVout[u.vout] = u
      }
    }
    const list = prepareVoutList.map((v) => byVout[v]).filter(Boolean)
    return list.length === 4
      ? (list as [
          ScripthashUtxoEntry,
          ScripthashUtxoEntry,
          ScripthashUtxoEntry,
          ScripthashUtxoEntry,
        ])
      : null
  }, [auxiliaryUtxos, effectivePrepTxid, prepareVoutList])

  const { missingVouts } = useMemo(() => {
    if (!effectivePrepTxid) return { missingVouts: [...prepareVoutList] }
    const prepTxidLower = effectivePrepTxid.toLowerCase()
    const found = new Set<number>()
    for (const u of utxos) {
      if (u.txid.trim().toLowerCase() === prepTxidLower && prepareVoutList.includes(u.vout)) {
        found.add(u.vout)
      }
    }
    const missingVouts = prepareVoutList.filter((v) => !found.has(v))
    return { missingVouts }
  }, [utxos, effectivePrepTxid, prepareVoutList])

  const someMissing = Boolean(effectivePrepTxid && missingVouts.length > 0)

  const [feeUtxoIndex, setFeeUtxoIndex] = useState(0)
  const [feeAmount, setFeeAmount] = useState('')
  const [toAddress, setToAddress] = useState(accountAddress ?? '')
  const [collateralAmount, setCollateralAmount] = useState('')
  const [principalAmount, setPrincipalAmount] = useState('')
  const [loanExpirationTime, setLoanExpirationTime] = useState('')
  const [interestPercent, setInterestPercent] = useState('')
  const [tokensDecimals, setTokensDecimals] = useState('0')
  const [building, setBuilding] = useState(false)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [broadcastError, setBroadcastError] = useState<string | null>(null)
  const [signedTxHex, setSignedTxHex] = useState<string | null>(null)
  const [broadcastTxid, setBroadcastTxid] = useState<string | null>(null)

  const loanExpirationNum = parseInt(loanExpirationTime, 10) || 0
  const endsInLabel = useMemo(
    () => formatEndsIn(loanExpirationNum, currentBlockHeight ?? null),
    [loanExpirationNum, currentBlockHeight]
  )

  const runBuild = useCallback(
    async (broadcast: boolean) => {
      if (!issuanceUtxosOrdered || !effectivePrepTxid || !seedHex) {
        setBuildError('Missing issuance UTXOs or seed')
        return
      }
      const issuanceEntropyBytes = crypto.getRandomValues(new Uint8Array(32))

      const feeNum = parseInt(feeAmount, 10) || 0
      const collateralNum = BigInt(collateralAmount || '0')
      const principalNum = BigInt(principalAmount || '0')
      const decimals = Math.max(0, Math.min(15, parseInt(tokensDecimals, 10) || 0))

      const feeUtxo = nativeUtxos[feeUtxoIndex]
      if (!feeUtxo || feeNum <= 0 || (feeUtxo.value ?? 0) < feeNum) {
        setBuildError('Invalid fee UTXO or amount')
        return
      }

      setBuildError(null)
      setBroadcastError(null)
      setBuilding(true)
      try {
        const tx = await esplora.getTx(effectivePrepTxid)
        const prevouts = prepareVoutList.map((v) => tx.vout?.[v]).filter(Boolean)
        if (prevouts.length !== 4) {
          setBuildError('Could not load prevouts for prepare tx')
          return
        }

        const issuanceUtxos: [
          { outpoint: { txid: string; vout: number }; prevout: (typeof tx.vout)[0] },
          { outpoint: { txid: string; vout: number }; prevout: (typeof tx.vout)[0] },
          { outpoint: { txid: string; vout: number }; prevout: (typeof tx.vout)[0] },
          { outpoint: { txid: string; vout: number }; prevout: (typeof tx.vout)[0] },
        ] = [
          {
            outpoint: { txid: effectivePrepTxid, vout: prepareVoutList[0]! },
            prevout: prevouts[0]!,
          },
          {
            outpoint: { txid: effectivePrepTxid, vout: prepareVoutList[1]! },
            prevout: prevouts[1]!,
          },
          {
            outpoint: { txid: effectivePrepTxid, vout: prepareVoutList[2]! },
            prevout: prevouts[2]!,
          },
          {
            outpoint: { txid: effectivePrepTxid, vout: prepareVoutList[3]! },
            prevout: prevouts[3]!,
          },
        ]

        const feeTx = await esplora.getTx(feeUtxo.txid)
        const feePrevout = feeTx.vout?.[feeUtxo.vout]
        if (!feePrevout) {
          setBuildError('Fee UTXO prevout not found')
          return
        }

        const firstAmount = encodeFirstNFTParameters(
          percentToBasisPoints(parseFloat(interestPercent || '0')),
          loanExpirationNum,
          decimals,
          decimals
        )
        const secondAmount = encodeSecondNFTParameters(
          toBaseAmount(collateralNum, decimals),
          toBaseAmount(principalNum, decimals)
        )

        const seed = parseSeedHex(seedHex)
        const secret = deriveSecretKeyFromIndex(seed, accountIndex)

        const result = await buildAndSignIssueUtilityNftsTx({
          issuanceUtxos,
          feeUtxo: { outpoint: { txid: feeUtxo.txid, vout: feeUtxo.vout }, prevout: feePrevout },
          issuanceEntropyBytes,
          firstParametersNftAmount: firstAmount,
          secondParametersNftAmount: secondAmount,
          utilityNftsToAddress: toAddress.trim(),
          feeAmount: BigInt(feeNum),
          secretKey: secret,
          network: P2PK_NETWORK,
        })

        setSignedTxHex(result.signedTxHex)

        if (broadcast) {
          const txidRes = await esplora.broadcastTx(result.signedTxHex)
          setBroadcastTxid(txidRes)
          onSuccess(txidRes)
        }
      } catch (e) {
        if (e instanceof EsploraApiError) {
          setBroadcastError(e.body ?? e.message)
        } else {
          setBuildError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        setBuilding(false)
      }
    },
    [
      issuanceUtxosOrdered,
      effectivePrepTxid,
      prepareVoutList,
      seedHex,
      feeAmount,
      collateralAmount,
      principalAmount,
      interestPercent,
      loanExpirationNum,
      tokensDecimals,
      toAddress,
      feeUtxoIndex,
      nativeUtxos,
      accountIndex,
      esplora,
      onSuccess,
    ]
  )

  const handleBuild = () => runBuild(false)
  const handleBuildAndBroadcast = () => runBuild(true)

  const canBuild =
    issuanceUtxosOrdered != null &&
    nativeUtxos.length > 0 &&
    feeAmount.trim() !== '' &&
    toAddress.trim() !== '' &&
    collateralAmount.trim() !== '' &&
    principalAmount.trim() !== '' &&
    loanExpirationTime.trim() !== ''

  return (
    <section className="min-w-0 max-w-4xl">
      <h3 className="text-lg font-semibold text-gray-900 mb-2">Step 2: Issue Utility NFTs</h3>
      <div className="space-y-4 text-sm">
        {hasAutoFilledPrepTxid ? (
          <div className="p-3 rounded-lg border border-gray-200 bg-gray-50 text-gray-800">
            <p className="font-medium text-gray-700 mb-1">Prepare transaction</p>
            <p className="font-mono text-xs break-all">
              Txid: {preparedTxid}
              <br />
              Issuance UTXOs: vouts {prepareFirstVout}, {prepareFirstVout + 1},{' '}
              {prepareFirstVout + 2}, {prepareFirstVout + 3}
            </p>
          </div>
        ) : (
          <>
            <div>
              <p className={formClassNames.label}>Prep issuance tx id</p>
              <Input
                type="text"
                placeholder="Txid from prepare"
                className="w-full max-w-lg font-mono"
                value={manualPrepTxId}
                onChange={(e) => setManualPrepTxId(e.target.value)}
              />
            </div>
          </>
        )}

        {someMissing && (
          <p className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-800">
            Not all 4 UTXOs from the prepare tx were found (missing vouts: {missingVouts.join(', ')}
            ).
          </p>
        )}

        {auxiliaryAssetIdNorm && (
          <div className="p-3 rounded-lg border border-gray-200 bg-gray-50 text-gray-800">
            <p className="font-medium text-gray-700 mb-1">Auxiliary asset</p>
            <p className="font-mono text-xs break-all mb-1">AssetId: {storedAuxiliaryAssetId}</p>
            <p className="text-gray-600">
              Found {auxiliaryUtxos.length} UTXO(s) (need {ISSUANCE_UTXOS_NEEDED}).
            </p>
            {issuanceUtxosOrdered && (
              <p className="text-green-700 mt-1">Ready to issue Utility NFTs.</p>
            )}
          </div>
        )}

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
          <p className={formClassNames.label}>
            <span className="inline-flex items-center gap-1">
              Fee amount (sats)
              <InfoTooltip
                content="Fee paid in LBTC from the selected fee UTXO."
                aria-label="Fee amount help"
              />
            </span>
          </p>
          <Input
            type="number"
            min={1}
            className="w-28"
            value={feeAmount}
            onChange={(e) => setFeeAmount(e.target.value)}
          />
        </div>

        <div>
          <p className={formClassNames.label}>To address (NFTs and change)</p>
          <Input
            type="text"
            className="w-full max-w-lg font-mono"
            value={toAddress}
            onChange={(e) => setToAddress(e.target.value)}
          />
        </div>

        <p className={formClassNames.label + ' mt-4'}>Offer parameters</p>
        <div className="grid gap-2 max-w-md">
          <div>
            <label className={formClassNames.label}>Collateral amount</label>
            <Input
              type="number"
              min={0}
              className="w-full"
              value={collateralAmount}
              onChange={(e) => setCollateralAmount(e.target.value)}
            />
          </div>
          <div>
            <label className={formClassNames.label}>Principal amount</label>
            <Input
              type="number"
              min={0}
              className="w-full"
              value={principalAmount}
              onChange={(e) => setPrincipalAmount(e.target.value)}
            />
          </div>
          <div>
            <label className={formClassNames.label}>Offer end (block height)</label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="number"
                min={0}
                className="w-full flex-1 min-w-0"
                value={loanExpirationTime}
                onChange={(e) => setLoanExpirationTime(e.target.value)}
              />
              {currentBlockHeight != null && (
                <button
                  type="button"
                  onClick={() => setLoanExpirationTime(String(currentBlockHeight))}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  Use current ({currentBlockHeight})
                </button>
              )}
            </div>
            {endsInLabel && <p className={formClassNames.helper}>Ends in {endsInLabel}</p>}
          </div>
          <div>
            <label className={formClassNames.label}>Interest rate (%)</label>
            <Input
              type="number"
              min={0}
              max={100}
              step={0.01}
              placeholder="e.g. 5"
              className="w-full"
              value={interestPercent}
              onChange={(e) => setInterestPercent(e.target.value)}
            />
          </div>
          <div>
            <label className={formClassNames.label}>Token decimals (0–15)</label>
            <Input
              type="number"
              min={0}
              max={15}
              className="w-20"
              value={tokensDecimals}
              onChange={(e) => setTokensDecimals(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center mt-4">
          <ButtonSecondary size="md" disabled={!canBuild || building} onClick={handleBuild}>
            {building ? 'Building…' : 'Build & Sign'}
          </ButtonSecondary>
          <ButtonPrimary
            size="md"
            disabled={!canBuild || building}
            onClick={handleBuildAndBroadcast}
          >
            {building ? 'Building…' : 'Build & Broadcast'}
          </ButtonPrimary>
        </div>

        {buildError && <p className="text-red-600">{buildError}</p>}
        {broadcastError && <p className="text-red-600">{broadcastError}</p>}
        {broadcastTxid && (
          <p className="text-green-700">Broadcast successful. Txid: {broadcastTxid}</p>
        )}
        {signedTxHex && !broadcastTxid && (
          <p className="text-gray-600 mt-2">
            Signed transaction ready. Copy and broadcast via explorer if needed.
          </p>
        )}
      </div>
    </section>
  )
}
