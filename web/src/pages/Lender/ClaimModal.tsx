/**
 * Modal to claim principal after repayment (lender): spend Repayment UTXO (principal at AssetAuth) + Lender NFT + fee,
 * receive principal to lender address. Opens when user clicks a repaid offer in YOUR SUPPLY.
 */

import { useMemo, useState, useEffect, useRef } from 'react'
import { Modal } from '../../components/Modal'
import { TxActionButtons } from '../../components/TxActionButtons'
import { TxStatusBlock } from '../../components/TxStatusBlock'
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
  getCurrentLenderParticipant,
} from '../../api/client'
import { P2PK_NETWORK, POLICY_ASSET_ID } from '../../utility/addressP2pk'
import { assetIdDisplayToInternal } from '../../utility/hex'
import { buildAssetAuthUnlockTx } from '../../tx/assetAuthUnlock/buildAssetAuthUnlockTx'
import { finalizeAssetAuthUnlockTx } from '../../tx/assetAuthUnlock/finalizeAssetAuthUnlockTx'
import { parseSeedHex, deriveSecretKeyFromIndex } from '../../utility/seed'
import type { PsetWithExtractTx } from '../../simplicity'
import type { BuildAssetAuthUnlockTxResult } from '../../tx/assetAuthUnlock/buildAssetAuthUnlockTx'

function shortId(id: string, headLen = 8, tailLen = 4): string {
  if (!id || id.length <= headLen + tailLen) return id
  return `${id.slice(0, headLen)}…${id.slice(-tailLen)}`
}

export interface ClaimModalProps {
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

export function ClaimModal({
  offer,
  utxos,
  esplora,
  open,
  onClose,
  accountAddress,
  seedHex: seedHexProp = null,
  accountIndex = 0,
  onSuccess,
}: ClaimModalProps) {
  const [offerUtxos, setOfferUtxos] = useState<Awaited<ReturnType<typeof fetchOfferUtxos>> | null>(
    null
  )
  const [offerUtxosLoading, setOfferUtxosLoading] = useState(false)
  const [offerUtxosError, setOfferUtxosError] = useState<string | null>(null)
  const [participantsHistory, setParticipantsHistory] = useState<Awaited<
    ReturnType<typeof fetchOfferParticipantsHistory>
  > | null>(null)
  const [destinationAddress, setDestinationAddress] = useState('')
  const [feeUtxoIndex, setFeeUtxoIndex] = useState(0)
  const [feeAmount, setFeeAmount] = useState('500')
  const [building, setBuilding] = useState(false)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [builtTx, setBuiltTx] = useState<BuildAssetAuthUnlockTxResult | null>(null)
  const [unsignedTxHex, setUnsignedTxHex] = useState<string | null>(null)
  const [signedTxHex, setSignedTxHex] = useState<string | null>(null)
  const [broadcastTxid, setBroadcastTxid] = useState<string | null>(null)

  const nativeUtxos = useMemo(() => {
    const policyId = POLICY_ASSET_ID[P2PK_NETWORK]
    return utxos.filter((u) => !u.asset || u.asset.trim().toLowerCase() === policyId)
  }, [utxos])

  const repaymentUtxo = useMemo(() => {
    if (!offerUtxos) return null
    const u = offerUtxos.find((o) => o.utxo_type === 'repayment' && o.spent_txid == null)
    return u ?? null
  }, [offerUtxos])

  const currentLenderParticipant = useMemo(() => {
    if (!participantsHistory) return null
    return getCurrentLenderParticipant(participantsHistory)
  }, [participantsHistory])

  useEffect(() => {
    if (open && offer.id) {
      setOfferUtxos(null)
      setOfferUtxosError(null)
      setParticipantsHistory(null)
      setOfferUtxosLoading(true)
      setBuildError(null)
      setBuiltTx(null)
      setUnsignedTxHex(null)
      setSignedTxHex(null)
      setBroadcastTxid(null)
      setDestinationAddress(accountAddress ?? '')
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

  const handleBuild = async () => {
    if (!repaymentUtxo) {
      setBuildError('No unspent principal (repayment) UTXO to claim.')
      return
    }
    if (!currentLenderParticipant) {
      setBuildError(
        'Current Lender NFT not found. It may already be spent or the data is not yet indexed.'
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
      const [repaymentTx, lenderNftTx, feeTx] = await Promise.all([
        esplora.getTx(repaymentUtxo.txid),
        esplora.getTx(currentLenderParticipant.txid),
        esplora.getTx(feeEntry.txid),
      ])
      const lockedPrevout = repaymentTx.vout?.[repaymentUtxo.vout]
      if (!lockedPrevout) throw new Error('Repayment (locked) prevout not found.')
      const authPrevout = lenderNftTx.vout?.[currentLenderParticipant.vout]
      if (!authPrevout) throw new Error('Lender NFT prevout not found.')
      const feePrevout = feeTx.vout?.[feeEntry.vout]
      if (!feePrevout) throw new Error('Fee UTXO prevout not found.')

      const authAssetHex = (authPrevout.asset ?? '').trim()
      if (!authAssetHex || authAssetHex.length !== 64) {
        throw new Error('Lender NFT prevout must have explicit 32-byte asset')
      }

      const result = await buildAssetAuthUnlockTx({
        lockedUtxo: {
          outpoint: { txid: repaymentUtxo.txid, vout: repaymentUtxo.vout },
          prevout: lockedPrevout,
        },
        authUtxo: {
          outpoint: {
            txid: currentLenderParticipant.txid,
            vout: currentLenderParticipant.vout,
          },
          prevout: authPrevout,
        },
        feeUtxo: {
          outpoint: { txid: feeEntry.txid, vout: feeEntry.vout },
          prevout: feePrevout,
        },
        feeAmount: BigInt(feeNum),
        assetAuthArguments: {
          assetId: assetIdDisplayToInternal(authAssetHex),
          assetAmount: 1,
          withAssetBurn: true,
        },
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
      const authAssetHex = (builtTx.prevouts[1]?.asset ?? '').trim()
      if (!authAssetHex || authAssetHex.length !== 64) {
        throw new Error('Auth prevout asset missing')
      }
      const signed = await finalizeAssetAuthUnlockTx({
        pset: builtTx.pset as PsetWithExtractTx,
        prevouts: builtTx.prevouts,
        assetAuthArguments: {
          assetId: assetIdDisplayToInternal(authAssetHex),
          assetAmount: 1,
          withAssetBurn: true,
        },
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

  const handleClaim = async () => {
    if (!signedTxHex) {
      setBuildError('Sign transaction first.')
      return
    }
    setBuildError(null)
    setBuilding(true)
    try {
      const txid = await esplora.broadcastTx(signedTxHex)
      setBroadcastTxid(txid)
      onSuccess?.()
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
  const principalExplorerUrl = esplora.getAssetExplorerUrl(offer.principal_asset)

  const handleClose = () => {
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
      title={`Claim ${principalLabel}`}
      contentClassName="max-w-xl"
    >
      {broadcastTxid ? (
        <BroadcastStatusContent
          txid={broadcastTxid}
          successMessage={getBroadcastSuccessMessage('claim')}
          esplora={esplora}
          onClose={handleClose}
        />
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-gray-600">
            Claim the principal (with interest) that the borrower sent to the covenant after
            repayment. Principal will be sent to the destination address below (default: your
            address).
          </p>

          {offerUtxosLoading && <p className="text-gray-500">Loading offer UTXOs…</p>}
          {offerUtxosError && (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{offerUtxosError}</p>
          )}
          {!offerUtxosLoading && offerUtxos != null && !repaymentUtxo && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              No unspent principal (repayment) UTXO to claim. It may already be claimed.
            </p>
          )}

          {repaymentUtxo && participantsHistory != null && !currentLenderParticipant && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              Current Lender NFT not found. It may already be spent or the data is not yet indexed.
            </p>
          )}

          {repaymentUtxo && currentLenderParticipant && (
            <>
              <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
                <h3 className="mb-2 text-base font-semibold text-gray-900">Principal to claim</h3>
                <p className="font-mono text-xs text-gray-800">
                  Repayment UTXO: {shortId(repaymentUtxo.txid, 10)} : {repaymentUtxo.vout}
                </p>
                <p className="mt-2 text-sm text-gray-700">
                  Lender NFT (auth): {shortId(currentLenderParticipant.txid, 10)} :
                  {currentLenderParticipant.vout}
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  Principal asset:{' '}
                  <a
                    href={principalExplorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    {shortId(offer.principal_asset, 8)}
                  </a>
                </p>
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-sm font-semibold uppercase text-gray-700">
                    Principal destination
                  </h3>
                  <InfoTooltip content="Address that will receive the claimed principal." />
                </div>
                <Input
                  type="text"
                  className="w-full font-mono text-sm"
                  placeholder="Liquid address"
                  value={destinationAddress}
                  onChange={(e) => setDestinationAddress(e.target.value)}
                />
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

              <TxActionButtons
                building={building}
                hasBuiltTx={!!builtTx}
                hasSignedTx={!!signedTxHex}
                onBuild={() => void handleBuild()}
                onSign={() => void handleSign()}
                onSignAndBroadcast={() => void handleClaim()}
                broadcastButtonLabel="Claim"
                canBuild={nativeUtxos.length > 0}
              />

              <TxStatusBlock
                unsignedTxHex={unsignedTxHex}
                signedTxHex={signedTxHex}
                error={buildError}
              />
              <div ref={bottomAnchorRef} aria-hidden="true" />
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
