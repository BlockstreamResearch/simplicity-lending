/**
 * Modal to cancel a pending offer (borrower/creator only): spend PreLock + 4 NFTs + fee,
 * return collateral to the chosen address. Only for offers with status pending.
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
  P2PK_NETWORK,
  POLICY_ASSET_ID,
  getScriptPubkeyHexFromAddress,
} from '../../utility/addressP2pk'
import {
  buildPreLockCancellationTx,
  type BuildPreLockCancellationTxResult,
  type CancellationUtxo,
} from '../../tx/preLockCancellation/buildPreLockCancellationTx'
import { buildPreLockArgumentsFromOfferCreation } from '../../utility/preLockCovenants'
import { finalizePreLockCancellationTx } from '../../tx/preLockCancellation/finalizePreLockCancellationTx'
import { parseSeedHex, deriveSecretKeyFromIndex } from '../../utility/seed'
import type { PsetWithExtractTx } from '../../simplicity'
import type { PreLockArguments } from '../../utility/preLockArguments'

export interface CancelOfferModalProps {
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

export function CancelOfferModal({
  offer,
  utxos,
  esplora,
  open,
  onClose,
  accountAddress,
  seedHex: seedHexProp = null,
  accountIndex = 0,
  onSuccess,
}: CancelOfferModalProps) {
  const [creationTx, setCreationTx] = useState<Awaited<ReturnType<typeof esplora.getTx>> | null>(
    null
  )
  const [creationTxError, setCreationTxError] = useState<string | null>(null)
  const [destinationAddress, setDestinationAddress] = useState('')
  const [feeUtxoIndex, setFeeUtxoIndex] = useState(0)
  const [feeAmount, setFeeAmount] = useState('500')
  const [building, setBuilding] = useState(false)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [preLockArguments, setPreLockArguments] = useState<PreLockArguments | null>(null)
  const [builtTx, setBuiltTx] = useState<BuildPreLockCancellationTxResult | null>(null)
  const [signedTxHex, setSignedTxHex] = useState<string | null>(null)
  const [broadcastTxid, setBroadcastTxid] = useState<string | null>(null)

  const nativeUtxos = useMemo(() => {
    const policyId = POLICY_ASSET_ID[P2PK_NETWORK]
    return utxos.filter((u) => !u.asset || u.asset.trim().toLowerCase() === policyId)
  }, [utxos])

  useEffect(() => {
    if (open && offer.id && offer.status === 'pending' && offer.created_at_txid) {
      setCreationTx(null)
      setCreationTxError(null)
      setBuildError(null)
      setBuiltTx(null)
      setSignedTxHex(null)
      setBroadcastTxid(null)
      setDestinationAddress(accountAddress ?? '')
      setPreLockArguments(null)
      esplora
        .getTx(offer.created_at_txid)
        .then(setCreationTx)
        .catch((e) => {
          setCreationTxError(e instanceof Error ? e.message : String(e))
        })
    }
  }, [open, offer.id, offer.status, offer.created_at_txid, accountAddress, esplora])

  const handleBuild = async () => {
    if (offer.status !== 'pending') {
      setBuildError('Only pending offers can be cancelled.')
      return
    }
    if (!creationTx) {
      setBuildError('Offer creation tx not loaded.')
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

    const dest = destinationAddress.trim()
    if (!dest) {
      setBuildError('Enter collateral destination address.')
      return
    }

    setBuildError(null)
    setBuiltTx(null)
    setSignedTxHex(null)
    setBroadcastTxid(null)
    setBuilding(true)
    try {
      const collateralOutputScriptHex = await getScriptPubkeyHexFromAddress(dest)

      const feeTx = await esplora.getTx(feeEntry.txid)
      const feePrevout = feeTx.vout?.[feeEntry.vout]
      if (!feePrevout || feePrevout.value == null) {
        throw new Error('Fee UTXO prevout not found or confidential.')
      }

      const feeUtxo: CancellationUtxo = {
        outpoint: { txid: feeEntry.txid, vout: feeEntry.vout },
        prevout: feePrevout,
      }

      const { preLockArguments } = await buildPreLockArgumentsFromOfferCreation(
        offer,
        creationTx,
        P2PK_NETWORK
      )

      const result = await buildPreLockCancellationTx({
        offer,
        offerCreationTx: creationTx,
        collateralOutputScriptHex,
        feeUtxo,
        feeAmount: BigInt(feeNum),
        preLockArguments,
        network: P2PK_NETWORK,
      })

      setPreLockArguments(preLockArguments)
      setBuiltTx(result)
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
    if (!preLockArguments) {
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
      const signed = await finalizePreLockCancellationTx({
        pset: builtTx.pset as PsetWithExtractTx,
        prevouts: builtTx.prevouts,
        preLockArguments,
        network: 'testnet',
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

  const handleBroadcast = async () => {
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

  const handleClose = () => {
    if (broadcastTxid) {
      onSuccess?.()
    }
    setBroadcastTxid(null)
    onClose()
  }

  const bottomAnchorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (buildError || builtTx || signedTxHex) {
      bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [buildError, builtTx, signedTxHex])

  if (open && offer.status !== 'pending') {
    return (
      <Modal open={open} onClose={onClose} title="Cancel offer">
        <p className="text-sm text-amber-800">
          Only pending offers can be cancelled. This offer has status &quot;{offer.status}&quot;.
        </p>
      </Modal>
    )
  }

  return (
    <Modal open={open} onClose={handleClose} title="Cancel offer" contentClassName="max-w-xl">
      {broadcastTxid ? (
        <BroadcastStatusContent
          txid={broadcastTxid}
          successMessage={getBroadcastSuccessMessage('cancel_offer')}
          esplora={esplora}
          onClose={handleClose}
        />
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-gray-600">
            Cancel this pending offer and get your locked collateral back. Collateral will be sent
            to the destination address below (default: your address).
          </p>

          {!creationTx && !creationTxError && (
            <p className="text-gray-500">Loading offer creation tx…</p>
          )}
          {creationTxError && (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{creationTxError}</p>
          )}

          {creationTx && (
            <>
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-sm font-semibold uppercase text-gray-700">
                    Collateral destination
                  </h3>
                  <InfoTooltip content="Address that will receive the returned collateral." />
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
                onSignAndBroadcast={() => void handleBroadcast()}
                broadcastButtonLabel="Cancel offer"
                canBuild={nativeUtxos.length > 0}
              />

              <TxStatusBlock
                unsignedTxHex={builtTx?.unsignedTxHex ?? null}
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
