/**
 * Modal for lender to view offer details and confirm accept.
 * Supply UTXOs (principal asset, exact amount, even satoshis) shown at top; no manual UTXO pick.
 * Transaction details: Fee UTXO (LBTC) + Fee amount.
 */

import { useMemo, useState, useEffect } from 'react'
import { Modal } from '../../components/Modal'
import { BroadcastStatusContent } from '../../components/PostBroadcastModal'
import { getBroadcastSuccessMessage } from '../../components/broadcastSuccessMessages'
import { InfoTooltip } from '../../components/InfoTooltip'
import { CopyIcon } from '../../components/CopyIcon'
import { Input } from '../../components/Input'
import { UtxoSelect } from '../../components/UtxoSelect'
import { formClassNames } from '../../components/formClassNames'
import type { OfferShort } from '../../types/offers'
import type { ScripthashUtxoEntry } from '../../api/esplora'
import type { EsploraClient } from '../../api/esplora'
import { P2PK_NETWORK, POLICY_ASSET_ID } from '../../utility/addressP2pk'
import { buildAcceptOfferTx } from '../../tx/acceptOffer/buildAcceptOfferTx'
import { finalizeAcceptOfferTx } from '../../tx/acceptOffer/finalizeAcceptOfferTx'
import { parseSeedHex, deriveSecretKeyFromIndex } from '../../utility/seed'
import type { PsetWithExtractTx } from '../../simplicity'

const BLOCKS_PER_DAY_LIQUID = 1440

function shortId(id: string, headLen = 8, tailLen?: number): string {
  const tail = tailLen ?? 4
  if (!id || id.length <= headLen + tail) return id
  return `${id.slice(0, headLen)}…${id.slice(-tail)}`
}

function formatSats(amount: bigint | number): string {
  const n = Number(amount)
  if (Number.isSafeInteger(n)) return n.toLocaleString()
  return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function normalizeAssetHex(hex: string): string {
  return (hex ?? '').trim().toLowerCase().replace(/^0x/, '')
}

export interface AcceptOfferModalProps {
  offer: OfferShort
  utxos: ScripthashUtxoEntry[]
  esplora: EsploraClient
  open: boolean
  onClose: () => void
  currentBlockHeight?: number | null
  /** If provided with accountIndex, transaction will be finalized and signed. */
  seedHex?: string | null
  accountIndex?: number
}

/** UTXOs that match principal asset, exact principal amount, and even satoshis. */
function getSupplyUtxos(
  utxos: ScripthashUtxoEntry[],
  principalAssetHex: string,
  principalAmount: bigint
): ScripthashUtxoEntry[] {
  const assetNorm = normalizeAssetHex(principalAssetHex)
  const amountNum = Number(principalAmount)
  return utxos.filter((u) => {
    const uAsset = normalizeAssetHex(u.asset ?? '')
    if (uAsset !== assetNorm) return false
    const val = u.value ?? 0
    if (val !== amountNum) return false
    if (val % 2 !== 0) return false
    return true
  })
}

export function AcceptOfferModal({
  offer,
  utxos,
  esplora,
  open,
  onClose,
  currentBlockHeight = null,
  seedHex: seedHexProp = null,
  accountIndex = 0,
}: AcceptOfferModalProps) {
  const [feeUtxoIndex, setFeeUtxoIndex] = useState(0)
  const [feeAmount, setFeeAmount] = useState('500')
  const [supplyUtxoIndex, setSupplyUtxoIndex] = useState(0)
  const [building, setBuilding] = useState(false)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [builtTx, setBuiltTx] = useState<Awaited<ReturnType<typeof buildAcceptOfferTx>> | null>(null)
  const [unsignedTxHex, setUnsignedTxHex] = useState<string | null>(null)
  const [signedTxHex, setSignedTxHex] = useState<string | null>(null)
  const [broadcastTxid, setBroadcastTxid] = useState<string | null>(null)

  const supplyUtxos = useMemo(
    () => getSupplyUtxos(utxos, offer.principal_asset, offer.principal_amount),
    [utxos, offer.principal_asset, offer.principal_amount]
  )

  useEffect(() => {
    if (open) {
      setFeeUtxoIndex(0)
      setFeeAmount('500')
      setSupplyUtxoIndex(0)
      setBuildError(null)
      setBuiltTx(null)
      setUnsignedTxHex(null)
      setSignedTxHex(null)
      setBroadcastTxid(null)
      setBuilding(false)
    }
  }, [open, offer.id])

  useEffect(() => {
    if (supplyUtxos.length > 0 && supplyUtxoIndex >= supplyUtxos.length) {
      setSupplyUtxoIndex(0)
    }
  }, [supplyUtxos.length, supplyUtxoIndex])

  const nativeUtxos = useMemo(() => {
    const policyId = POLICY_ASSET_ID[P2PK_NETWORK]
    return utxos.filter((u) => !u.asset || u.asset.trim().toLowerCase() === policyId)
  }, [utxos])

  const expiryBlocks =
    currentBlockHeight != null ? offer.loan_expiration_time - currentBlockHeight : null
  const termDays =
    expiryBlocks != null && expiryBlocks > 0
      ? Math.round(expiryBlocks / BLOCKS_PER_DAY_LIQUID)
      : null

  const handleBuild = async () => {
    if (supplyUtxos.length === 0) return

    setBuildError(null)
    setBuiltTx(null)
    setUnsignedTxHex(null)
    setSignedTxHex(null)
    setBroadcastTxid(null)

    const principalIdx = Math.min(supplyUtxoIndex, supplyUtxos.length - 1)
    const principalEntry = supplyUtxos[principalIdx]
    if (!principalEntry) {
      setBuildError('Select a supply UTXO.')
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

    setBuilding(true)
    try {
      const [offerCreationTx, principalTx, feeTx] = await Promise.all([
        esplora.getTx(offer.created_at_txid),
        esplora.getTx(principalEntry.txid),
        esplora.getTx(feeEntry.txid),
      ])

      const principalPrevout = principalTx.vout?.[principalEntry.vout]
      if (!principalPrevout) throw new Error('Principal UTXO prevout not found.')
      const feePrevout = feeTx.vout?.[feeEntry.vout]
      if (!feePrevout) throw new Error('Fee UTXO prevout not found.')

      const result = await buildAcceptOfferTx({
        offer,
        offerCreationTx,
        principalUtxo: {
          outpoint: { txid: principalEntry.txid, vout: principalEntry.vout },
          prevout: principalPrevout,
        },
        feeUtxo: {
          outpoint: { txid: feeEntry.txid, vout: feeEntry.vout },
          prevout: feePrevout,
        },
        feeAmount: BigInt(feeNum),
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
      const signed = await finalizeAcceptOfferTx({
        pset: builtTx.pset as PsetWithExtractTx,
        prevouts: builtTx.prevouts,
        preLockArguments: builtTx.preLockArguments,
        lendingCovHash: builtTx.lendingCovHash,
        network: P2PK_NETWORK,
        lenderSecretKey: secretKey,
      })
      setSignedTxHex(signed.signedTxHex)
      setBroadcastTxid(null)
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuilding(false)
    }
  }

  const handleAcceptOffer = async () => {
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
      setBuildError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuilding(false)
    }
  }

  const principalLabel = shortId(offer.principal_asset, 4).toUpperCase()
  const collateralExplorerUrl = esplora.getAssetExplorerUrl(offer.collateral_asset)
  const principalExplorerUrl = esplora.getAssetExplorerUrl(offer.principal_asset)

  const interestRatePercent = (offer.interest_rate / 100).toFixed(2)
  const totalToRepay = useMemo(() => {
    return (offer.principal_amount * (10000n + BigInt(offer.interest_rate))) / 10000n
  }, [offer.principal_amount, offer.interest_rate])

  const copyAssetId = (text: string) => {
    void navigator.clipboard.writeText(text)
  }

  const handleClose = () => {
    setBroadcastTxid(null)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`${principalLabel} Supply Offer`}
      contentClassName="max-w-xl"
    >
      {broadcastTxid ? (
        <BroadcastStatusContent
          txid={broadcastTxid}
          successMessage={getBroadcastSuccessMessage('accept_offer')}
          esplora={esplora}
          onClose={handleClose}
        />
      ) : (
      <div className="space-y-6">
        {/* Supply UTXO */}
        <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
          <h3 className="mb-2 text-base font-semibold text-gray-900">Supply UTXO</h3>
          {supplyUtxos.length === 0 ? (
            <p className="text-sm text-gray-700">
              For this offer you need {formatSats(offer.principal_amount)} of asset{' '}
              {shortId(offer.principal_asset)} (even satoshis).
            </p>
          ) : supplyUtxos.length === 1 ? (
            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
              <span className="font-mono text-xs text-gray-900">
                {shortId(supplyUtxos[0].txid, 6)}
              </span>
              <span className="text-gray-700"> : {supplyUtxos[0].vout} — </span>
              <span className="tabular-nums text-gray-900">
                {formatSats(supplyUtxos[0].value ?? 0)} sats
              </span>
            </div>
          ) : (
            <>
              <UtxoSelect
                className="max-w-full"
                utxos={supplyUtxos}
                value={String(Math.min(supplyUtxoIndex, supplyUtxos.length - 1))}
                onChange={(v) => setSupplyUtxoIndex(parseInt(v, 10))}
                optionValueType="index"
                labelSuffix="sats"
              />
            </>
          )}
        </div>

        {/* Loan Info */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold uppercase text-gray-700">Loan info</h3>
            <InfoTooltip content="Offer parameters: collateral, principal, term, interest, total to repay." />
          </div>
          <div className="space-y-3 text-sm">
            <div>
              <p className="mb-1 text-gray-500">Collateral Asset</p>
              <div className="flex items-center gap-1">
                <a
                  href={collateralExplorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-gray-800 underline"
                >
                  {shortId(offer.collateral_asset, 10, 10)}
                </a>
                <button
                  type="button"
                  onClick={() => copyAssetId(offer.collateral_asset)}
                  title="Copy asset ID"
                  className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  aria-label="Copy asset ID"
                >
                  <CopyIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div>
              <p className="mb-1 text-gray-500">Principal Asset</p>
              <div className="flex items-center gap-1">
                <a
                  href={principalExplorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-gray-800 underline"
                >
                  {shortId(offer.principal_asset, 10, 10)}
                </a>
                <button
                  type="button"
                  onClick={() => copyAssetId(offer.principal_asset)}
                  title="Copy asset ID"
                  className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  aria-label="Copy asset ID"
                >
                  <CopyIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 pt-1">
              <div>
                <p className="text-gray-500">Collateral</p>
                <p className="font-medium text-gray-900">
                  {formatSats(offer.collateral_amount)}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Borrow</p>
                <p className="font-medium text-gray-900">
                  {formatSats(offer.principal_amount)}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Interest Rate</p>
                <p className="font-medium text-gray-900">{interestRatePercent}%</p>
              </div>
              <div>
                <p className="text-gray-500">Total to repay</p>
                <p className="font-medium text-gray-900">
                  {formatSats(totalToRepay)}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Term (blocks)</p>
                <p className="font-medium text-gray-900">
                  {termDays != null ? `~${termDays} days` : '—'}
                  <span className="block text-gray-500">
                    {offer.loan_expiration_time.toLocaleString()} blocks
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Transaction Details */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold uppercase text-gray-700">Transaction details</h3>
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
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="button"
            disabled={supplyUtxos.length === 0 || building}
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
            onClick={() => void handleAcceptOffer()}
            className="flex-1 min-w-[180px] rounded-lg bg-[#5F3DC4] px-4 py-3 text-sm font-medium text-white hover:bg-[#4f36a8] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {building ? 'Working…' : 'Accept Offer'}
          </button>
        </div>

        {signedTxHex && (
          <div className="mt-2 p-3 bg-green-50 text-green-800 rounded border border-green-200 text-sm">
            <p className="font-medium">Transaction signed.</p>
            <p className="mt-1 font-mono text-xs break-all">Raw hex: {signedTxHex.slice(0, 120)}…</p>
          </div>
        )}
        {unsignedTxHex && !signedTxHex && (
          <div className="mt-2 p-3 bg-green-50 text-green-800 rounded border border-green-200 text-sm">
            <p className="font-medium">Transaction built (unsigned).</p>
            <p className="mt-1 font-mono text-xs break-all">Raw hex: {unsignedTxHex.slice(0, 120)}…</p>
          </div>
        )}
        {buildError && (
          <p className="mt-2 p-3 bg-red-50 text-red-800 rounded border border-red-200 text-sm">
            {buildError}
          </p>
        )}
      </div>
      )}
    </Modal>
  )
}
