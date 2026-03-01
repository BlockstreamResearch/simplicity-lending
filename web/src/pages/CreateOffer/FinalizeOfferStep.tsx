/**
 * Step 2: Finalize offer (PreLock creation). Form + data loading from issuance tx, validation, build flow.
 * NFT outpoints from Step 1 (Issue Utility NFTs): same txid, vout 0=Borrower, 1=Lender, 2=First params, 3=Second params.
 */

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import type { EsploraClient } from '../../api/esplora'
import type { ScripthashUtxoEntry } from '../../api/esplora'
import type { EsploraTx } from '../../api/esplora'
import { EsploraApiError } from '../../api/esplora'
import { formatBroadcastError } from '../../utils/parseBroadcastError'
import { P2PK_NETWORK, POLICY_ASSET_ID, getP2pkAddressFromSecret } from '../../utility/addressP2pk'
import { parseSeedHex, deriveSecretKeyFromIndex } from '../../utility/seed'
import { buildLendingParamsFromParameterNFTs } from '../../utility/parametersEncoding'
import { buildPreLockArguments } from '../../utility/preLockArguments'
import { hexToBytes32, normalizeHex, assetIdDisplayToInternal } from '../../utility/hex'
import { computePreLockCovenantHashes } from '../../utility/preLockCovenants'
import type { PsetWithExtractTx } from '../../simplicity'
import {
  buildPreLockCreationTx,
  finalizePreLockCreationTx,
} from '../../tx/preLockCreation/buildPreLockCreationTx'
import { TxActionButtons } from '../../components/TxActionButtons'
import { TxStatusBlock } from '../../components/TxStatusBlock'
import { Input } from '../../components/Input'
import { UtxoSelect } from '../../components/UtxoSelect'
import { formClassNames } from '../../components/formClassNames'

export interface FinalizeOfferStepProps {
  accountIndex: number
  accountAddress: string | null
  utxos: ScripthashUtxoEntry[]
  esplora: EsploraClient
  seedHex: string
  issuanceTxid: string | null
  onSuccess: () => void
  /** When provided, called with txid after broadcast instead of onSuccess; parent shows post-broadcast modal and calls onSuccess when modal closes. */
  onBroadcastTxid?: (txid: string) => void
}

/** Order in Issue Utility NFTs tx: vout 0=Borrower, 1=Lender, 2=First params, 3=Second params. */
const NFT_VOUT_ORDER = [
  { label: 'First parameters NFT', vout: 2 },
  { label: 'Second parameters NFT', vout: 3 },
  { label: 'Borrower NFT', vout: 0 },
  { label: 'Lender NFT', vout: 1 },
] as const

export function FinalizeOfferStep({
  accountAddress,
  utxos,
  issuanceTxid,
  esplora,
  seedHex,
  accountIndex,
  onSuccess,
  onBroadcastTxid,
}: FinalizeOfferStepProps) {
  const [collateralUtxoIndex, setCollateralUtxoIndex] = useState(0)
  const [principalAssetIdHex, setPrincipalAssetIdHex] = useState('')
  const [issuanceTxId, setIssuanceTxId] = useState(() => issuanceTxid ?? '')
  const [feeUtxoIndex, setFeeUtxoIndex] = useState(0)
  const [feeAmount, setFeeAmount] = useState('')
  const [toAddress, setToAddress] = useState(accountAddress ?? '')
  const [stubMessage, setStubMessage] = useState<string | null>(null)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [issuanceTx, setIssuanceTx] = useState<EsploraTx | null>(null)
  const [lendingParams, setLendingParams] = useState<ReturnType<
    typeof buildLendingParamsFromParameterNFTs
  > | null>(null)
  const [loadingIssuance, setLoadingIssuance] = useState(false)
  const [issuanceLoadError, setIssuanceLoadError] = useState<string | null>(null)
  const [building, setBuilding] = useState(false)
  const [builtPreLockTx, setBuiltPreLockTx] = useState<Awaited<
    ReturnType<typeof buildPreLockCreationTx>
  > | null>(null)
  const [signedTxHex, setSignedTxHex] = useState<string | null>(null)
  const [broadcastError, setBroadcastError] = useState<string | null>(null)

  const bottomAnchorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (buildError || broadcastError || signedTxHex) {
      bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [buildError, broadcastError, signedTxHex])

  useEffect(() => {
    const txid = issuanceTxId.trim()
    if (!txid) {
      setIssuanceTx(null)
      setLendingParams(null)
      setIssuanceLoadError(null)
      return
    }
    let cancelled = false
    setLoadingIssuance(true)
    setIssuanceLoadError(null)
    esplora
      .getTx(txid)
      .then((tx) => {
        if (cancelled) return
        const vout = tx.vout ?? []
        if (vout.length < 4) {
          setIssuanceLoadError('Issuance tx must have at least 4 vouts')
          setIssuanceTx(null)
          setLendingParams(null)
          return
        }
        const v2 = vout[2]?.value
        const v3 = vout[3]?.value
        if (typeof v2 !== 'number' || typeof v3 !== 'number') {
          setIssuanceLoadError('Vout 2 and 3 must have explicit value')
          setIssuanceTx(null)
          setLendingParams(null)
          return
        }
        try {
          const params = buildLendingParamsFromParameterNFTs(BigInt(v2), BigInt(v3))
          setLendingParams(params)
          setIssuanceTx(tx)
        } catch (e) {
          setIssuanceLoadError(e instanceof Error ? e.message : String(e))
          setLendingParams(null)
          setIssuanceTx(null)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setIssuanceLoadError(e instanceof Error ? e.message : String(e))
          setIssuanceTx(null)
          setLendingParams(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingIssuance(false)
      })
    return () => {
      cancelled = true
    }
  }, [esplora, issuanceTxId])

  const nativeUtxos = useMemo(() => {
    const policyId = POLICY_ASSET_ID[P2PK_NETWORK]
    return utxos.filter((u) => !u.asset || u.asset.trim().toLowerCase() === policyId)
  }, [utxos])

  const handleBuild = useCallback(async () => {
    setBuildError(null)
    setStubMessage(null)
    setBuiltPreLockTx(null)
    setSignedTxHex(null)
    const principalHex = normalizeHex(principalAssetIdHex)
    if (principalHex.length !== 64) {
      setBuildError('Principal asset ID must be 64 hex chars (32 bytes).')
      return
    }
    if (!toAddress.trim()) {
      setBuildError('To address is required.')
      return
    }
    if (!lendingParams || !issuanceTx?.vout?.length) {
      setBuildError('Load issuance tx first (enter txid and wait for loading).')
      return
    }
    const collateralUtxo = nativeUtxos[collateralUtxoIndex]
    if (!collateralUtxo) {
      setBuildError('Select a collateral UTXO (LBTC).')
      return
    }
    if (collateralUtxoIndex === feeUtxoIndex) {
      setBuildError('Collateral and Fee must be different UTXOs.')
      return
    }
    const collateralValue = BigInt(collateralUtxo.value ?? 0)
    if (collateralValue < lendingParams.collateralAmount) {
      setBuildError(
        `Collateral UTXO value ${collateralValue} is less than required ${lendingParams.collateralAmount}.`
      )
      return
    }
    const feeNum = parseInt(feeAmount, 10) || 0
    if (feeNum <= 0) {
      setBuildError('Fee amount must be at least 1.')
      return
    }
    const feeUtxo = nativeUtxos[feeUtxoIndex]
    if (!feeUtxo || BigInt(feeUtxo.value ?? 0) < BigInt(feeNum)) {
      setBuildError('Fee UTXO has insufficient value.')
      return
    }
    if (!seedHex) {
      setBuildError('Seed is required for borrower pubkey derivation.')
      return
    }

    setBuilding(true)
    try {
      const secretKey = deriveSecretKeyFromIndex(parseSeedHex(seedHex), accountIndex)
      const { internalKeyHex } = await getP2pkAddressFromSecret(secretKey, P2PK_NETWORK)
      const borrowerPubKey = hexToBytes32(internalKeyHex)

      const vout = issuanceTx.vout!
      const policyAssetHex = POLICY_ASSET_ID[P2PK_NETWORK]
      const collateralAssetId = assetIdDisplayToInternal(policyAssetHex)
      const hexTo32 = (h: string) => {
        const n = normalizeHex(h)
        if (n.length !== 64) throw new Error('Expected 64 hex chars')
        return assetIdDisplayToInternal(n)
      }
      const principalAssetId = assetIdDisplayToInternal(principalHex)
      const borrowerNftAssetId = hexTo32(String(vout[0]?.asset ?? ''))
      const lenderNftAssetId = hexTo32(String(vout[1]?.asset ?? ''))
      const firstParamsNftAssetId = hexTo32(String(vout[2]?.asset ?? ''))
      const secondParamsNftAssetId = hexTo32(String(vout[3]?.asset ?? ''))

      const covenantResult = await computePreLockCovenantHashes({
        collateralAssetId,
        principalAssetId,
        borrowerNftAssetId,
        lenderNftAssetId,
        firstParametersNftAssetId: firstParamsNftAssetId,
        secondParametersNftAssetId: secondParamsNftAssetId,
        lendingParams,
        borrowerPubKey,
        network: P2PK_NETWORK,
      })

      const preLockArguments = buildPreLockArguments({
        collateralAssetId,
        principalAssetId,
        borrowerNftAssetId,
        lenderNftAssetId,
        firstParametersNftAssetId: firstParamsNftAssetId,
        secondParametersNftAssetId: secondParamsNftAssetId,
        lendingCovHash: covenantResult.lendingCovHash,
        parametersNftOutputScriptHash: covenantResult.parametersNftOutputScriptHash,
        borrowerNftOutputScriptHash: covenantResult.borrowerP2trScriptHash,
        principalOutputScriptHash: covenantResult.borrowerP2trScriptHash,
        borrowerPubKey,
        lendingParams,
      })

      const issuanceTxidTrimmed = issuanceTxId.trim()
      const v0 = vout[0]
      const v1 = vout[1]
      const v2 = vout[2]
      const v3 = vout[3]
      if (!v0 || !v1 || !v2 || !v3) {
        setBuildError('Issuance tx must have vouts 0–3.')
        return
      }

      const collateralTx = await esplora.getTx(collateralUtxo.txid)
      const collateralPrevout = collateralTx.vout?.[collateralUtxo.vout]
      if (!collateralPrevout) {
        setBuildError('Collateral UTXO prevout not found.')
        return
      }
      const feeTx = await esplora.getTx(feeUtxo.txid)
      const feePrevout = feeTx.vout?.[feeUtxo.vout]
      if (!feePrevout) {
        setBuildError('Fee UTXO prevout not found.')
        return
      }

      const result = await buildPreLockCreationTx({
        collateralUtxo: {
          outpoint: { txid: collateralUtxo.txid, vout: collateralUtxo.vout },
          prevout: collateralPrevout,
        },
        firstParametersNftUtxo: {
          outpoint: { txid: issuanceTxidTrimmed, vout: 2 },
          prevout: v2,
        },
        secondParametersNftUtxo: {
          outpoint: { txid: issuanceTxidTrimmed, vout: 3 },
          prevout: v3,
        },
        borrowerNftUtxo: {
          outpoint: { txid: issuanceTxidTrimmed, vout: 0 },
          prevout: v0,
        },
        lenderNftUtxo: {
          outpoint: { txid: issuanceTxidTrimmed, vout: 1 },
          prevout: v1,
        },
        feeUtxo: {
          outpoint: { txid: feeUtxo.txid, vout: feeUtxo.vout },
          prevout: feePrevout,
        },
        preLockArguments,
        preLockScriptPubkeyHex: covenantResult.preLockScriptPubkeyHex,
        utilityNftsOutputScriptHex: covenantResult.utilityNftsOutputScriptHex,
        feeAmount: BigInt(feeNum),
        network: P2PK_NETWORK,
      })

      setBuiltPreLockTx(result)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (
        msg.includes('Backend or WASM') ||
        msg.includes('require Simplicity') ||
        msg.includes('async LWK')
      ) {
        setStubMessage(
          'PreLock creation requires LWK Simplicity (WASM). Use the CLI or ensure lwk_web is loaded.'
        )
      } else {
        setBuildError(msg)
      }
    } finally {
      setBuilding(false)
    }
  }, [
    principalAssetIdHex,
    toAddress,
    lendingParams,
    issuanceTx,
    issuanceTxId,
    nativeUtxos,
    collateralUtxoIndex,
    feeUtxoIndex,
    feeAmount,
    seedHex,
    accountIndex,
    esplora,
  ])

  const handleSignAndBroadcast = useCallback(
    async (broadcast: boolean) => {
      if (!builtPreLockTx) {
        setBuildError('Build the transaction first (click Build).')
        return
      }
      if (!seedHex) {
        setBuildError('Seed is required to sign.')
        return
      }
      setBuildError(null)
      setBroadcastError(null)
      setBuilding(true)
      try {
        const secretKey = deriveSecretKeyFromIndex(parseSeedHex(seedHex), accountIndex)
        const { signedTxHex: hex } = await finalizePreLockCreationTx({
          pset: builtPreLockTx.pset as PsetWithExtractTx,
          prevouts: builtPreLockTx.prevouts,
          secretKey,
          network: P2PK_NETWORK,
        })
        setSignedTxHex(hex)
        if (broadcast) {
          const txid = await esplora.broadcastTx(hex)
          if (onBroadcastTxid) {
            onBroadcastTxid(txid)
          } else {
            onSuccess()
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (e instanceof EsploraApiError) {
          setBroadcastError(formatBroadcastError(e.body ?? e.message))
        } else {
          setBuildError(msg)
        }
      } finally {
        setBuilding(false)
      }
    },
    [builtPreLockTx, seedHex, accountIndex, esplora, onSuccess, onBroadcastTxid]
  )

  const handleBroadcast = useCallback(async () => {
    if (!signedTxHex) {
      setBuildError('Sign the transaction first.')
      return
    }
    setBuildError(null)
    setBroadcastError(null)
    setBuilding(true)
    try {
      const txid = await esplora.broadcastTx(signedTxHex)
      if (onBroadcastTxid) {
        onBroadcastTxid(txid)
      } else {
        onSuccess()
      }
    } catch (e) {
      if (e instanceof EsploraApiError) {
        setBroadcastError(formatBroadcastError(e.body ?? e.message))
      } else {
        setBuildError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setBuilding(false)
    }
  }, [signedTxHex, esplora, onSuccess, onBroadcastTxid])

  return (
    <section className="min-w-0 max-w-4xl">
      <h3 className="text-lg font-semibold text-gray-900 mb-2">Step 2: Finalize offer</h3>
      <div className="space-y-4 text-sm">
        <div>
          <p className={formClassNames.label}>Collateral UTXO (LBTC)</p>
          {nativeUtxos.length === 0 ? (
            <p className="text-gray-500">No LBTC UTXOs.</p>
          ) : (
            <UtxoSelect
              className="max-w-md"
              utxos={nativeUtxos}
              value={String(collateralUtxoIndex)}
              onChange={(v) => setCollateralUtxoIndex(parseInt(v, 10))}
              optionValueType="index"
              labelSuffix="sats"
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
          <p className={formClassNames.label}>Issuance tx id (from Step 1)</p>
          <Input
            type="text"
            placeholder="Txid from Step 1"
            className="w-full max-w-lg font-mono"
            value={issuanceTxId}
            onChange={(e) => setIssuanceTxId(e.target.value)}
          />
          {loadingIssuance && <p className={formClassNames.helper}>Loading issuance tx…</p>}
          {issuanceLoadError && <p className="mt-1 text-red-600 text-xs">{issuanceLoadError}</p>}
          {lendingParams && !issuanceLoadError && (
            <p className={formClassNames.helper}>
              Collateral: {String(lendingParams.collateralAmount)} · Principal:{' '}
              {String(lendingParams.principalAmount)} · Expiry block:{' '}
              {lendingParams.loanExpirationTime} · Interest: {lendingParams.principalInterestRate}{' '}
              bp
            </p>
          )}
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
          <TxActionButtons
            building={building}
            hasBuiltTx={!!builtPreLockTx}
            hasSignedTx={!!signedTxHex}
            onBuild={() => void handleBuild()}
            onSign={() => void handleSignAndBroadcast(false)}
            onSignAndBroadcast={handleBroadcast}
            broadcastButtonLabel="Sign & Broadcast"
          />
        </div>

        <TxStatusBlock
          unsignedTxHex={builtPreLockTx?.unsignedTxHex ?? null}
          signedTxHex={signedTxHex}
          error={buildError || broadcastError || undefined}
        />
        {stubMessage && (
          <p className="mt-2 p-3 bg-amber-50 text-amber-800 rounded border border-amber-200 text-sm">
            {stubMessage}
          </p>
        )}
        <div ref={bottomAnchorRef} aria-hidden="true" />
      </div>
    </section>
  )
}
