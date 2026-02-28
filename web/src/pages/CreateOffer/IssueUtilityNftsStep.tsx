/**
 * Step 2: Issue Utility NFTs. Builds and signs (or broadcasts) the tx per utility_nfts_issuing.rs.
 * Uses 4 auxiliary UTXOs (from prepare at firstVout..firstVout+3) + 1 fee UTXO; generates fresh issuance entropy.
 */

import { useState, useMemo, useCallback, useEffect } from 'react'
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
  decodeFirstNFTParameters,
  decodeSecondNFTParameters,
} from '../../utility/parametersEncoding'
import type { PsetWithExtractTx } from '../../simplicity'
import { buildIssueUtilityNftsTx, finalizeIssueUtilityNftsTx } from '../../tx/issueUtilityNfts/buildIssueUtilityNftsTx'
import { ButtonPrimary, ButtonSecondary, ButtonNeutral } from '../../components/Button'
import { Input } from '../../components/Input'
import { UtxoSelect } from '../../components/UtxoSelect'
import { formClassNames } from '../../components/formClassNames'
import { InfoTooltip } from '../../components/InfoTooltip'
import type { Step1Summary } from './CreateOfferWizard'

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  )
}

const TOKEN_DECIMALS = 1
/** Wider tooltip on step 1 (no min-width so modal size is unchanged). */
const STEP1_TOOLTIP_CLASS = 'max-w-[22rem]'

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
  /** When set, show read-only summary of completed step 1 (user returned to this step). */
  step1Summary?: Step1Summary | null
  /** When set and step1Summary is null, fetch summary from Esplora by this txid (for recovery flow). */
  issuanceTxidForSummary?: string | null
  onSuccess: (txid: string, summary: Step1Summary) => void
  /** When user clicks "Start over" on the summary view. */
  onStartOver?: () => void
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
  step1Summary = null,
  issuanceTxidForSummary = null,
  onSuccess,
  onStartOver,
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

  const effectivePrepTxid = (preparedTxid ?? '').trim() || null

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
  const [collateralAmount, setCollateralAmount] = useState('')
  const [principalAmount, setPrincipalAmount] = useState('')
  const [loanExpirationTime, setLoanExpirationTime] = useState('')
  const [interestPercent, setInterestPercent] = useState('')
  const [building, setBuilding] = useState(false)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [builtIssueTx, setBuiltIssueTx] = useState<Awaited<
    ReturnType<typeof buildIssueUtilityNftsTx>
  > | null>(null)
  const [broadcastError, setBroadcastError] = useState<string | null>(null)
  const [signedTxHex, setSignedTxHex] = useState<string | null>(null)
  const [broadcastTxid, setBroadcastTxid] = useState<string | null>(null)
  const [fetchedSummary, setFetchedSummary] = useState<Step1Summary | null>(null)
  const [summaryFetchError, setSummaryFetchError] = useState<string | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(false)

  const loanExpirationNum = parseInt(loanExpirationTime, 10) || 0

  useEffect(() => {
    const txid = (issuanceTxidForSummary ?? '').trim()
    if (!txid || step1Summary != null) {
      setFetchedSummary(null)
      setSummaryFetchError(null)
      setLoadingSummary(false)
      return
    }
    let cancelled = false
    setLoadingSummary(true)
    setSummaryFetchError(null)
    esplora
      .getTx(txid)
      .then((tx) => {
        if (cancelled) return
        const vouts = tx.vout ?? []
        const v2 = vouts[2]
        const v3 = vouts[3]
        if (!v2?.value || v2.value < 0 || !v3?.value || v3.value < 0) {
          setSummaryFetchError('Transaction missing or invalid Parameter NFT outputs.')
          setFetchedSummary(null)
          setLoadingSummary(false)
          return
        }
        const first = decodeFirstNFTParameters(BigInt(v2.value))
        const second = decodeSecondNFTParameters(BigInt(v3.value))
        const collateralDec = first.collateralDec
        const principalDec = first.principalDec
        const collateralSat = second.collateralBaseAmount * 10 ** collateralDec
        const principalSat = second.principalBaseAmount * 10 ** principalDec
        setFetchedSummary({
          txid,
          collateralAmount: String(collateralSat),
          principalAmount: String(principalSat),
          feeAmount: '—',
          loanExpirationTime: String(first.loanExpirationTime),
          interestPercent: (first.interestRateBasisPoints / 100).toFixed(2),
          toAddress: '',
        })
        setLoadingSummary(false)
      })
      .catch((e) => {
        if (!cancelled) {
          setSummaryFetchError(
            e instanceof EsploraApiError
              ? (e.body ?? e.message)
              : e instanceof Error
                ? e.message
                : String(e)
          )
          setFetchedSummary(null)
          setLoadingSummary(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [esplora, issuanceTxidForSummary, step1Summary])

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
          TOKEN_DECIMALS,
          TOKEN_DECIMALS
        )
        const secondAmount = encodeSecondNFTParameters(
          toBaseAmount(collateralNum, TOKEN_DECIMALS),
          toBaseAmount(principalNum, TOKEN_DECIMALS)
        )

        const built = await buildIssueUtilityNftsTx({
          issuanceUtxos,
          feeUtxo: { outpoint: { txid: feeUtxo.txid, vout: feeUtxo.vout }, prevout: feePrevout },
          issuanceEntropyBytes,
          firstParametersNftAmount: firstAmount,
          secondParametersNftAmount: secondAmount,
          utilityNftsToAddress: (accountAddress ?? '').trim(),
          feeAmount: BigInt(feeNum),
          network: P2PK_NETWORK,
        })
        setBuiltIssueTx(built)

        if (broadcast) {
          const seed = parseSeedHex(seedHex)
          const secret = deriveSecretKeyFromIndex(seed, accountIndex)
          const signedTxHex = await finalizeIssueUtilityNftsTx({
            pset: built.pset as PsetWithExtractTx,
            prevouts: built.prevouts,
            secretKey: secret,
            network: P2PK_NETWORK,
          })
          setSignedTxHex(signedTxHex)
          const txidRes = await esplora.broadcastTx(signedTxHex)
          setBroadcastTxid(txidRes)
          onSuccess(txidRes, {
            txid: txidRes,
            collateralAmount,
            principalAmount,
            feeAmount,
            loanExpirationTime,
            interestPercent,
            toAddress: accountAddress ?? '',
          })
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
      loanExpirationTime,
      accountAddress,
      feeUtxoIndex,
      nativeUtxos,
      accountIndex,
      esplora,
      onSuccess,
    ]
  )

  const handleSign = useCallback(async () => {
    if (!builtIssueTx || !seedHex) return
    setBuildError(null)
    setBuilding(true)
    try {
      const seed = parseSeedHex(seedHex)
      const secret = deriveSecretKeyFromIndex(seed, accountIndex)
      const signedTxHex = await finalizeIssueUtilityNftsTx({
        pset: builtIssueTx.pset as PsetWithExtractTx,
        prevouts: builtIssueTx.prevouts,
        secretKey: secret,
        network: P2PK_NETWORK,
      })
      setSignedTxHex(signedTxHex)
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuilding(false)
    }
  }, [builtIssueTx, seedHex, accountIndex])

  const handleSignAndBroadcast = useCallback(async () => {
    if (!builtIssueTx || !seedHex) return
    setBuildError(null)
    setBroadcastError(null)
    setBuilding(true)
    try {
      const seed = parseSeedHex(seedHex)
      const secret = deriveSecretKeyFromIndex(seed, accountIndex)
      const signedTxHex = await finalizeIssueUtilityNftsTx({
        pset: builtIssueTx.pset as PsetWithExtractTx,
        prevouts: builtIssueTx.prevouts,
        secretKey: secret,
        network: P2PK_NETWORK,
      })
      setSignedTxHex(signedTxHex)
      const txidRes = await esplora.broadcastTx(signedTxHex)
      setBroadcastTxid(txidRes)
      onSuccess(txidRes, {
        txid: txidRes,
        collateralAmount,
        principalAmount,
        feeAmount,
        loanExpirationTime,
        interestPercent,
        toAddress: accountAddress ?? '',
      })
    } catch (e) {
      if (e instanceof EsploraApiError) {
        setBroadcastError(e.body ?? e.message)
      } else {
        setBuildError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setBuilding(false)
    }
  }, [
    builtIssueTx,
    seedHex,
    accountIndex,
    collateralAmount,
    principalAmount,
    feeAmount,
    loanExpirationTime,
    interestPercent,
    accountAddress,
    esplora,
    onSuccess,
  ])

  const handleBuild = () => runBuild(false)
  const handleBuildAndBroadcast = () => void handleSignAndBroadcast()

  const canBuild =
    issuanceUtxosOrdered != null &&
    nativeUtxos.length > 0 &&
    feeAmount.trim() !== '' &&
    (accountAddress ?? '').trim() !== '' &&
    collateralAmount.trim() !== '' &&
    principalAmount.trim() !== '' &&
    loanExpirationTime.trim() !== ''

  const aprPercent = parseFloat(interestPercent || '0')
  const principalNum = parseFloat(principalAmount || '0') || 0
  const totalRepay = principalNum * (1 + aprPercent / 100)

  const displaySummary = step1Summary ?? fetchedSummary
  if (displaySummary) {
    const txidShort =
      displaySummary.txid.length <= 20
        ? displaySummary.txid
        : `${displaySummary.txid.slice(0, 10)}…${displaySummary.txid.slice(-8)}`
    return (
      <section className="min-w-0 max-w-lg">
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
          <h3 className="font-semibold text-gray-900 mb-3">Issue Utility NFTs — summary</h3>
          <p className="font-medium text-gray-700 mb-1">Transaction</p>
          <div className="flex items-center gap-2 mb-3">
            <a
              href={esplora.getTxExplorerUrl(displaySummary.txid)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs text-[#5F3DC4] hover:underline truncate min-w-0"
              title={displaySummary.txid}
            >
              {txidShort}
            </a>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(displaySummary.txid)
              }}
              className="shrink-0 rounded p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
              title="Copy txid"
              aria-label="Copy txid"
            >
              <CopyIcon />
            </button>
          </div>
          <p className="font-medium text-gray-700 mb-2">Offer parameters used</p>
          <table className="text-gray-700 w-full text-sm">
            <tbody>
              <tr>
                <td className="py-0.5 pr-2 text-gray-600">Collateral</td>
                <td className="py-0.5">{displaySummary.collateralAmount} sat LBTC</td>
              </tr>
              <tr>
                <td className="py-0.5 pr-2 text-gray-600">Borrow</td>
                <td className="py-0.5">{displaySummary.principalAmount} sat ASSET</td>
              </tr>
              <tr>
                <td className="py-0.5 pr-2 text-gray-600">Duration (block)</td>
                <td className="py-0.5">
                  {(() => {
                    const blockNum = parseInt(displaySummary.loanExpirationTime, 10)
                    const endsIn =
                      !Number.isNaN(blockNum) && currentBlockHeight != null
                        ? formatEndsIn(blockNum, currentBlockHeight)
                        : ''
                    return endsIn
                      ? `block ${displaySummary.loanExpirationTime} (${endsIn})`
                      : `block ${displaySummary.loanExpirationTime}`
                  })()}
                </td>
              </tr>
              <tr>
                <td className="py-0.5 pr-2 text-gray-600">Interest</td>
                <td className="py-0.5">{displaySummary.interestPercent}%</td>
              </tr>
            </tbody>
          </table>
        </div>
        {onStartOver && (
          <div className="mt-3">
            <ButtonSecondary size="md" onClick={onStartOver}>
              Start flow from the beginning
            </ButtonSecondary>
          </div>
        )}
      </section>
    )
  }
  if (issuanceTxidForSummary?.trim() && loadingSummary) {
    return (
      <section className="min-w-0 max-w-lg">
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
          Loading summary…
        </div>
      </section>
    )
  }
  if (issuanceTxidForSummary?.trim() && summaryFetchError) {
    return (
      <section className="min-w-0 max-w-lg">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-medium mb-1">Could not load summary</p>
          <p className="text-sm">{summaryFetchError}</p>
        </div>
        {onStartOver && (
          <div className="mt-3">
            <ButtonSecondary size="md" onClick={onStartOver}>
              Start flow from the beginning
            </ButtonSecondary>
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="min-w-0 max-w-lg">
      <div className="space-y-4 text-sm">
        {someMissing && (
          <p className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-800">
            Not all 4 UTXOs from the prepare tx were found (missing vouts: {missingVouts.join(', ')}
            ).
          </p>
        )}

        <p className={formClassNames.label}>Offer parameters</p>
        <div className="space-y-4">
          <div>
            <label className={formClassNames.label}>
              <span className="inline-flex items-center gap-1">
                Collateral
                <InfoTooltip
                  content="Collateral amount in satoshis (LBTC)."
                  aria-label="Collateral help"
                  contentClassName={STEP1_TOOLTIP_CLASS}
                />
              </span>
            </label>
            <Input
              type="number"
              min={0}
              className="w-full"
              compact
              value={collateralAmount}
              onChange={(e) => setCollateralAmount(e.target.value)}
              suffix="sat LBTC"
            />
          </div>
          <div>
            <label className={formClassNames.label}>
              <span className="inline-flex items-center gap-1">
                Borrow
                <InfoTooltip
                  content="Principal to borrow in satoshis (ASSET)."
                  aria-label="Borrow help"
                  contentClassName={STEP1_TOOLTIP_CLASS}
                />
              </span>
            </label>
            <Input
              type="number"
              min={0}
              className="w-full"
              compact
              value={principalAmount}
              onChange={(e) => setPrincipalAmount(e.target.value)}
              suffix="sat ASSET"
            />
          </div>
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className={formClassNames.label + ' mb-0'}>
                <span className="inline-flex items-center gap-1">
                  Duration / Term (blocks)
                  <InfoTooltip
                    content="Block height at which the offer expires."
                    aria-label="Duration help"
                    contentClassName={STEP1_TOOLTIP_CLASS}
                  />
                </span>
              </label>
              {currentBlockHeight != null && (
                <button
                  type="button"
                  onClick={() => setLoanExpirationTime(String(currentBlockHeight))}
                  className="text-xs text-indigo-600 hover:underline bg-transparent border-none p-0 cursor-pointer"
                >
                  current
                </button>
              )}
            </div>
            <div className="space-y-1">
              <Input
                type="number"
                min={0}
                className="w-full"
                compact
                value={loanExpirationTime}
                onChange={(e) => setLoanExpirationTime(e.target.value)}
              />
              {endsInLabel && <p className={formClassNames.helper}>Ends in {endsInLabel}</p>}
            </div>
          </div>
          <div>
            <label className={formClassNames.label}>
              <span className="inline-flex items-center gap-1">
                Interest rate (%)
                <InfoTooltip
                  content="Annual percentage rate for the loan (e.g. 3.45)."
                  aria-label="Interest help"
                  contentClassName={STEP1_TOOLTIP_CLASS}
                />
              </span>
            </label>
            <Input
              type="number"
              min={0}
              max={100}
              step={0.01}
              placeholder="e.g. 3.45"
              className="w-full"
              compact
              value={interestPercent}
              onChange={(e) => {
                const raw = e.target.value.replace(',', '.')
                const m = raw.match(/^\d*\.?\d{0,2}/)
                setInterestPercent(m ? m[0] : interestPercent)
              }}
            />
          </div>
        </div>

        <div>
          <p className={formClassNames.label}>Transaction details</p>
          <div className="space-y-4">
            <div>
              <label className={formClassNames.label}>Fee UTXO (LBTC)</label>
              {nativeUtxos.length === 0 ? (
                <p className="text-gray-500">No LBTC UTXOs.</p>
              ) : (
                <UtxoSelect
                  className="max-w-full"
                  utxos={nativeUtxos}
                  value={String(feeUtxoIndex)}
                  onChange={(v) => setFeeUtxoIndex(parseInt(v, 10))}
                  optionValueType="index"
                  labelSuffix="sats"
                />
              )}
            </div>
            <div>
              <label className={formClassNames.label}>
                <span className="inline-flex items-center gap-1">
                  Fee amount
                  <InfoTooltip
                    content="Fee paid in satoshis from the selected fee UTXO."
                    aria-label="Fee amount help"
                    contentClassName={STEP1_TOOLTIP_CLASS}
                  />
                </span>
              </label>
              <Input
                type="number"
                min={1}
                className="w-full"
                compact
                value={feeAmount}
                onChange={(e) => setFeeAmount(e.target.value)}
                suffix="sat LBTC"
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <h4 className="font-semibold text-gray-900 mb-2">Offer summary</h4>
          <table className="text-sm text-gray-700 w-full">
            <tbody>
              <tr>
                <td className="py-0.5 pr-2 text-gray-600">Collateral</td>
                <td className="py-0.5">{collateralAmount || '0'} sat LBTC</td>
              </tr>
              <tr>
                <td className="py-0.5 pr-2 text-gray-600">Borrow</td>
                <td className="py-0.5">{principalAmount || '0'} sat ASSET</td>
              </tr>
              <tr>
                <td className="py-0.5 pr-2 text-gray-600">Offer ends</td>
                <td className="py-0.5">
                  block {loanExpirationTime || '—'}
                  {endsInLabel && ` (${endsInLabel})`}
                </td>
              </tr>
              <tr>
                <td className="py-0.5 pr-2 text-gray-600">Total to repay</td>
                <td className="py-0.5">
                  {totalRepay.toLocaleString(undefined, { maximumFractionDigits: 2 })} sat ASSET
                  {principalAmount && interestPercent && (
                    <span className="text-gray-500 ml-1">
                      (principal + {interestPercent}% interest)
                    </span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <ButtonSecondary size="md" disabled={!canBuild || building} onClick={handleBuild}>
            {building ? 'Building…' : 'Build'}
          </ButtonSecondary>
          <ButtonSecondary
            size="md"
            disabled={!builtIssueTx || building}
            onClick={() => void handleSign()}
          >
            {building ? 'Signing…' : 'Sign'}
          </ButtonSecondary>
          <ButtonPrimary
            size="md"
            disabled={!builtIssueTx || building}
            onClick={() => void handleBuildAndBroadcast()}
          >
            {building ? 'Signing…' : 'Sign & Broadcast'}
          </ButtonPrimary>
        </div>

        {builtIssueTx && !signedTxHex && !broadcastTxid && (
          <p className="text-blue-700 text-sm mt-1">Transaction built. Click Sign or Sign & Broadcast.</p>
        )}

        {buildError && <p className="text-red-600">{buildError}</p>}
        {broadcastError && <p className="text-red-600">{broadcastError}</p>}
        {broadcastTxid && (
          <p className="text-green-700">Broadcast successful. Txid: {broadcastTxid}</p>
        )}
        {signedTxHex && !broadcastTxid && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 mt-2">
            <p className="font-medium text-gray-700 mb-1">Signed transaction (hex)</p>
            <textarea
              readOnly
              className="w-full font-mono text-xs text-gray-900 bg-white border border-gray-200 rounded-xl p-2 h-24"
              value={signedTxHex}
            />
            <ButtonNeutral
              size="sm"
              className="mt-2"
              onClick={() => navigator.clipboard?.writeText(signedTxHex)}
            >
              Copy hex
            </ButtonNeutral>
          </div>
        )}
      </div>
    </section>
  )
}
