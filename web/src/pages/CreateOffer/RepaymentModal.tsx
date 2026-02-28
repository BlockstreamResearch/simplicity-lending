/**
 * Modal to repay an active loan (borrower): spend Lending UTXO + 3 NFTs + principal UTXO(s) + fee,
 * get collateral back. Opens when user clicks an active offer in YOUR BORROWS.
 */

import { useMemo, useState, useEffect, useRef } from 'react'
import { Modal } from '../../components/Modal'
import { BroadcastStatusContent } from '../../components/PostBroadcastModal'
import { getBroadcastSuccessMessage } from '../../components/broadcastSuccessMessages'
import { InfoTooltip } from '../../components/InfoTooltip'
import { Input } from '../../components/Input'
import { UtxoSelect } from '../../components/UtxoSelect'
import { formClassNames } from '../../components/formClassNames'
import type { OfferShort } from '../../types/offers'
import type { ScripthashUtxoEntry } from '../../api/esplora'
import type { EsploraClient } from '../../api/esplora'
import { EsploraApiError } from '../../api/esplora'
import { formatBroadcastError } from '../../utils/parseBroadcastError'
import {
  fetchOfferUtxos,
  fetchOfferParticipantsHistory,
  getCurrentBorrowerParticipant,
} from '../../api/client'
import { P2PK_NETWORK, POLICY_ASSET_ID } from '../../utility/addressP2pk'
import { getScriptPubkeyHexFromAddress } from '../../utility/addressP2pk'
import { buildLoanRepaymentTx } from '../../tx/loanRepayment/buildLoanRepaymentTx'
import { finalizeLoanRepaymentTx } from '../../tx/loanRepayment/finalizeLoanRepaymentTx'
import { calculatePrincipalWithInterest } from '../../tx/loanRepayment/principalWithInterest'
import { parseSeedHex, deriveSecretKeyFromIndex } from '../../utility/seed'
import type { PsetWithExtractTx } from '../../simplicity'
import type { BuildLoanRepaymentTxResult } from '../../tx/loanRepayment/buildLoanRepaymentTx'
import type { LoanRepaymentPrincipalUtxo } from '../../tx/loanRepayment/buildLoanRepaymentTx'
import { normalizeHex } from '../../utility/hex'

function shortId(id: string, headLen = 8, tailLen = 4): string {
  if (!id || id.length <= headLen + tailLen) return id
  return `${id.slice(0, headLen)}…${id.slice(-tailLen)}`
}

function formatSats(amount: bigint | number): string {
  const n = Number(amount)
  if (Number.isSafeInteger(n)) return n.toLocaleString()
  return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export interface RepaymentModalProps {
  offer: OfferShort
  utxos: ScripthashUtxoEntry[]
  esplora: EsploraClient
  open: boolean
  onClose: () => void
  accountAddress: string | null
  seedHex?: string | null
  accountIndex?: number
  onSuccess?: () => void
}

export function RepaymentModal({
  offer,
  utxos,
  esplora,
  open,
  onClose,
  accountAddress,
  seedHex: seedHexProp = null,
  accountIndex = 0,
  onSuccess,
}: RepaymentModalProps) {
  const [offerUtxos, setOfferUtxos] = useState<Awaited<ReturnType<typeof fetchOfferUtxos>> | null>(
    null
  )
  const [offerUtxosLoading, setOfferUtxosLoading] = useState(false)
  const [offerUtxosError, setOfferUtxosError] = useState<string | null>(null)
  const [participantsHistory, setParticipantsHistory] = useState<Awaited<
    ReturnType<typeof fetchOfferParticipantsHistory>
  > | null>(null)
  const [selectedPrincipalIndices, setSelectedPrincipalIndices] = useState<number[]>([])
  const [feeUtxoIndex, setFeeUtxoIndex] = useState(0)
  const [feeAmount, setFeeAmount] = useState('500')
  const [collateralDestinationAddress, setCollateralDestinationAddress] = useState('')
  const [building, setBuilding] = useState(false)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [builtTx, setBuiltTx] = useState<BuildLoanRepaymentTxResult | null>(null)
  const [unsignedTxHex, setUnsignedTxHex] = useState<string | null>(null)
  const [signedTxHex, setSignedTxHex] = useState<string | null>(null)
  const [broadcastTxid, setBroadcastTxid] = useState<string | null>(null)

  const principalAssetNorm = useMemo(
    () => normalizeHex(offer.principal_asset),
    [offer.principal_asset]
  )
  const principalUtxos = useMemo(() => {
    return utxos.filter((u) => {
      const a = normalizeHex(u.asset ?? '')
      return a === principalAssetNorm
    })
  }, [utxos, principalAssetNorm])

  const nativeUtxos = useMemo(() => {
    const policyId = POLICY_ASSET_ID[P2PK_NETWORK]
    return utxos.filter((u) => !u.asset || u.asset.trim().toLowerCase() === policyId)
  }, [utxos])

  const lendingUtxo = useMemo(() => {
    if (!offerUtxos) return null
    const u = offerUtxos.find((o) => o.utxo_type === 'lending' && o.spent_txid == null)
    return u ?? null
  }, [offerUtxos])

  const currentBorrowerParticipant = useMemo(() => {
    if (!participantsHistory) return null
    return getCurrentBorrowerParticipant(participantsHistory)
  }, [participantsHistory])

  const principalWithInterest = useMemo(
    () => calculatePrincipalWithInterest(offer.principal_amount, offer.interest_rate),
    [offer.principal_amount, offer.interest_rate]
  )
  const selectedPrincipalSum = useMemo(() => {
    return selectedPrincipalIndices.reduce((sum, idx) => {
      const u = principalUtxos[idx]
      if (!u) return sum
      const v = u.value
      return sum + (typeof v === 'number' && v >= 0 ? BigInt(v) : 0n)
    }, 0n)
  }, [selectedPrincipalIndices, principalUtxos])
  const principalSufficient = selectedPrincipalSum >= principalWithInterest

  useEffect(() => {
    if (open && offer.id) {
      setOfferUtxos(null)
      setOfferUtxosError(null)
      setParticipantsHistory(null)
      setOfferUtxosLoading(true)
      setSelectedPrincipalIndices([])
      setBuildError(null)
      setBuiltTx(null)
      setUnsignedTxHex(null)
      setSignedTxHex(null)
      setBroadcastTxid(null)
      setCollateralDestinationAddress(accountAddress ?? '')
      Promise.all([fetchOfferUtxos(offer.id), fetchOfferParticipantsHistory(offer.id)])
        .then(([utxosRes, participants]) => {
          setOfferUtxos(utxosRes)
          setParticipantsHistory(participants)
        })
        .catch((e) => {
          setOfferUtxosError(e instanceof Error ? e.message : String(e))
          setOfferUtxos([])
        })
        .finally(() => setOfferUtxosLoading(false))
    }
  }, [open, offer.id, accountAddress])

  const togglePrincipalIndex = (idx: number) => {
    setSelectedPrincipalIndices((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx].sort((a, b) => a - b)
    )
  }

  const handleBuild = async () => {
    if (!lendingUtxo || !collateralDestinationAddress.trim()) {
      setBuildError('Collateral destination address is required.')
      return
    }
    if (!currentBorrowerParticipant) {
      setBuildError(
        'Current Borrower NFT not found. It may already be spent or the offer was not accepted.'
      )
      return
    }
    if (selectedPrincipalIndices.length === 0) {
      setBuildError('Select at least one principal UTXO.')
      return
    }
    if (!principalSufficient) {
      setBuildError(
        `Selected principal sum ${selectedPrincipalSum} is less than principal+interest ${principalWithInterest}.`
      )
      return
    }

    const feeEntry = nativeUtxos[feeUtxoIndex]
    if (!feeEntry) {
      setBuildError('Select a fee UTXO (LBTC).')
      return
    }

    const feeNum = parseInt(feeAmount, 10) || 0
    if (feeNum <= 0) {
      setBuildError('Fee amount must be at least 1.')
      return
    }

    setBuildError(null)
    setBuiltTx(null)
    setUnsignedTxHex(null)
    setSignedTxHex(null)
    setBroadcastTxid(null)
    setBuilding(true)
    try {
      const [lendingTx, borrowerNftTx, feeTx, ...principalTxs] = await Promise.all([
        esplora.getTx(lendingUtxo.txid),
        esplora.getTx(currentBorrowerParticipant.txid),
        esplora.getTx(feeEntry.txid),
        ...selectedPrincipalIndices.map((idx) => {
          const u = principalUtxos[idx]
          if (!u) throw new Error('Principal UTXO entry missing')
          return esplora.getTx(u.txid)
        }),
      ])
      const borrowerNftPrevout = borrowerNftTx.vout?.[currentBorrowerParticipant.vout]
      if (!borrowerNftPrevout) throw new Error('Borrower NFT prevout not found.')
      const feePrevout = feeTx.vout?.[feeEntry.vout]
      if (!feePrevout) throw new Error('Fee UTXO prevout not found.')

      const principalUtxoParams: LoanRepaymentPrincipalUtxo[] = selectedPrincipalIndices.map(
        (idx, i) => {
          const u = principalUtxos[idx]
          if (!u) throw new Error('Principal UTXO entry missing')
          const tx = principalTxs[i]
          if (!tx) throw new Error('Principal tx missing')
          const prevout = tx.vout?.[u.vout]
          if (!prevout) throw new Error(`Principal prevout not found for ${u.txid}:${u.vout}`)
          return {
            outpoint: { txid: u.txid, vout: u.vout },
            prevout,
          }
        }
      )

      const collateralScriptHex = await getScriptPubkeyHexFromAddress(
        collateralDestinationAddress.trim()
      )
      const principalChangeScriptHex = accountAddress
        ? await getScriptPubkeyHexFromAddress(accountAddress.trim())
        : collateralScriptHex

      const result = await buildLoanRepaymentTx({
        lendingTx,
        borrowerNftUtxo: {
          outpoint: {
            txid: currentBorrowerParticipant.txid,
            vout: currentBorrowerParticipant.vout,
          },
          prevout: borrowerNftPrevout,
        },
        principalUtxos: principalUtxoParams,
        feeUtxo: {
          outpoint: { txid: feeEntry.txid, vout: feeEntry.vout },
          prevout: feePrevout,
        },
        feeAmount: BigInt(feeNum),
        collateralOutputScriptHex: collateralScriptHex,
        principalChangeScriptHex,
        offer,
        network: P2PK_NETWORK,
      })

      setBuiltTx(result)
      setUnsignedTxHex(result.unsignedTxHex)
      setSignedTxHex(null)
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuilding(false)
    }
  }

  const handleSign = async () => {
    if (!builtTx) {
      setBuildError('Build transaction first.')
      return
    }
    if (!seedHexProp) {
      setBuildError('Seed is required to sign.')
      return
    }

    setBuildError(null)
    setBuilding(true)
    try {
      const secretKey = deriveSecretKeyFromIndex(parseSeedHex(seedHexProp), accountIndex)
      const signed = await finalizeLoanRepaymentTx({
        pset: builtTx.pset as PsetWithExtractTx,
        prevouts: builtTx.prevouts,
        lendingCovHash: builtTx.lendingCovHash,
        lendingArgs: builtTx.lendingArgs,
        network: P2PK_NETWORK,
        borrowerSecretKey: secretKey,
      })
      setSignedTxHex(signed.signedTxHex)
      setBroadcastTxid(null)
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuilding(false)
    }
  }

  const handleRepay = async () => {
    if (!signedTxHex) {
      setBuildError('Sign transaction first.')
      return
    }
    setBuildError(null)
    setBuilding(true)
    try {
      const txid = await esplora.broadcastTx(signedTxHex)
      setBroadcastTxid(txid)
    } catch (e) {
      if (e instanceof EsploraApiError) {
        setBuildError(formatBroadcastError(e.body ?? e.message))
      } else {
        setBuildError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setBuilding(false)
    }
  }

  const principalLabel = shortId(offer.principal_asset, 4).toUpperCase()
  const collateralExplorerUrl = esplora.getAssetExplorerUrl(offer.collateral_asset)

  const handleClose = () => {
    if (broadcastTxid) {
      onSuccess?.()
    }
    setBroadcastTxid(null)
    onClose()
  }

  const bottomAnchorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (buildError || unsignedTxHex || signedTxHex) {
      bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [buildError, unsignedTxHex, signedTxHex])

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`Repay ${principalLabel}`}
      contentClassName="max-w-xl"
    >
      {broadcastTxid ? (
        <BroadcastStatusContent
          txid={broadcastTxid}
          successMessage={getBroadcastSuccessMessage('repayment')}
          esplora={esplora}
          onClose={handleClose}
        />
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-gray-600">
            Repay borrowed principal token and unlock the collateral.
          </p>

          {offerUtxosLoading && <p className="text-gray-500">Loading offer UTXOs…</p>}
          {offerUtxosError && (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{offerUtxosError}</p>
          )}
          {!offerUtxosLoading && offerUtxos != null && !lendingUtxo && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              No unspent Lending UTXO for this offer. It may not be accepted yet or already
              repaid/liquidated.
            </p>
          )}

          {lendingUtxo && participantsHistory != null && !currentBorrowerParticipant && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              Current Borrower NFT not found. It may already be spent or the data is not yet
              indexed.
            </p>
          )}

          {lendingUtxo && currentBorrowerParticipant && (
            <>
              <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
                <h3 className="mb-2 text-base font-semibold text-gray-900">Lending UTXO</h3>
                <p className="font-mono text-xs text-gray-800">
                  {shortId(lendingUtxo.txid, 10)} : {lendingUtxo.vout}
                </p>
                <p className="mt-2 text-sm text-gray-700">
                  Borrower NFT: {shortId(currentBorrowerParticipant.txid, 10)} :
                  {currentBorrowerParticipant.vout}
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  Collateral: {formatSats(offer.collateral_amount)} sats (
                  <a
                    href={collateralExplorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    {shortId(offer.collateral_asset, 8)}
                  </a>
                  )
                </p>
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-sm font-semibold uppercase text-gray-700">
                    Collateral destination
                  </h3>
                  <InfoTooltip content="Address that will receive your collateral after repayment." />
                </div>
                <Input
                  type="text"
                  className="w-full font-mono text-sm"
                  placeholder="Liquid address"
                  value={collateralDestinationAddress}
                  onChange={(e) => setCollateralDestinationAddress(e.target.value)}
                />
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-sm font-semibold uppercase text-gray-700">
                    Principal UTXOs ({principalLabel})
                  </h3>
                  <InfoTooltip content="Select one or more UTXOs in the principal asset. Sum must be at least principal + interest." />
                </div>
                {principalUtxos.length === 0 ? (
                  <p className="text-gray-500">No UTXOs in principal asset.</p>
                ) : (
                  <div className="max-h-48 space-y-1 overflow-y-auto rounded border border-gray-200 p-2">
                    {principalUtxos.map((u, idx) => {
                      const value =
                        typeof u.value === 'number' && u.value >= 0 ? BigInt(u.value) : 0n
                      const selected = selectedPrincipalIndices.includes(idx)
                      const disableCheckbox = principalSufficient && !selected
                      return (
                        <label
                          key={`${u.txid}:${u.vout}`}
                          className={`flex items-center gap-2 rounded px-2 py-1 ${
                            disableCheckbox
                              ? 'cursor-not-allowed opacity-60'
                              : 'cursor-pointer hover:bg-gray-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={disableCheckbox}
                            onChange={() => togglePrincipalIndex(idx)}
                            className="h-4 w-4"
                          />
                          <span className="font-mono text-xs text-gray-700">
                            {shortId(u.txid, 8)}:{u.vout}
                          </span>
                          <span className="text-xs text-gray-600">{formatSats(value)} sats</span>
                        </label>
                      )
                    })}
                  </div>
                )}
                {selectedPrincipalIndices.length > 0 && (
                  <p className="mt-1 text-sm text-gray-600">
                    Sum: {formatSats(selectedPrincipalSum)} — need{' '}
                    {formatSats(principalWithInterest)}{' '}
                    {principalSufficient ? (
                      <span className="text-green-600">✓</span>
                    ) : (
                      <span className="text-red-600">(insufficient)</span>
                    )}
                  </p>
                )}
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="text-sm font-semibold uppercase text-gray-700">
                    Transaction details
                  </h3>
                  <InfoTooltip content="Fee is paid in LBTC. Select a UTXO and amount for the transaction fee." />
                </div>
                <div className="space-y-4">
                  <div>
                    <p className={formClassNames.label}>Fee UTXO (LBTC)</p>
                    {nativeUtxos.length === 0 ? (
                      <p className="text-gray-500">No LBTC UTXOs.</p>
                    ) : (
                      <UtxoSelect
                        className="max-w-md"
                        utxos={nativeUtxos}
                        value={String(Math.min(feeUtxoIndex, nativeUtxos.length - 1))}
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
                </div>
              </div>

              <div className="flex flex-wrap gap-2 items-center">
                <button
                  type="button"
                  disabled={
                    nativeUtxos.length === 0 ||
                    principalUtxos.length === 0 ||
                    !principalSufficient ||
                    building
                  }
                  onClick={() => void handleBuild()}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {building ? 'Working…' : 'Build'}
                </button>
                <button
                  type="button"
                  disabled={!builtTx || building}
                  onClick={() => void handleSign()}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {building ? 'Working…' : 'Sign'}
                </button>
                <button
                  type="button"
                  disabled={!signedTxHex || building}
                  onClick={() => void handleRepay()}
                  className="flex-1 min-w-[180px] rounded-lg bg-[#5F3DC4] px-4 py-3 text-sm font-medium text-white hover:bg-[#4f36a8] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {building ? 'Working…' : 'Repay'}
                </button>
              </div>

              {unsignedTxHex && !signedTxHex && (
                <div className="mt-2 p-3 bg-green-50 text-green-800 rounded border border-green-200 text-sm">
                  <p className="font-medium">Transaction built (unsigned).</p>
                  <p className="mt-1 font-mono text-xs break-all">
                    Raw hex: {unsignedTxHex.slice(0, 120)}…
                  </p>
                </div>
              )}
              {signedTxHex && (
                <div className="mt-2 p-3 bg-green-50 text-green-800 rounded border border-green-200 text-sm">
                  <p className="font-medium">Transaction signed.</p>
                  <p className="mt-1 text-sm">Click Repay to broadcast.</p>
                </div>
              )}
              {buildError && (
                <p className="mt-2 p-3 bg-red-50 text-red-800 rounded border border-red-200 text-sm">
                  {buildError}
                </p>
              )}
              <div ref={bottomAnchorRef} aria-hidden="true" />
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
