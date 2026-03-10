import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import {
  fetchOfferDetailsBatchWithParticipants,
  fetchOfferIdsByBorrowerPubkey,
  fetchOfferIdsByScripts,
  fetchOfferParticipantsHistory,
  fetchOfferUtxos,
  getCurrentBorrowerParticipant,
} from '../api/client'
import { EsploraClient, resolveWalletFeeRateSatKvb } from '../api/esplora'
import { OfferTable } from '../components/OfferTable'
import { Input } from '../components/Input'
import { formClassNames } from '../components/formClassNames'
import {
  loadBorrowerFlowState,
  saveBorrowerFlowState,
  clearBorrowerFlowState,
} from '../walletAbi/borrowerStorage'
import {
  loadTrackedBorrowerOfferIds,
  rememberTrackedBorrowerOfferId,
} from '../walletAbi/borrowerTrackedStorage'
import { requireWalletAbiSuccess } from '../walletAbi/response'
import { loadKnownWalletScripts } from '../walletAbi/walletScriptStorage'
import {
  buildCancelOfferRequest,
  buildCreateOfferRequest,
  buildIssueUtilityNftsRequest,
  buildPrepareUtilityNftsRequest,
  buildRepayLoanRequest,
  decodeIssuedUtilityNfts,
  resolvePrepareUtilityNftsInputUnblindings,
  type ProtocolTerms,
} from '../walletAbi/requestBuilders'
import { useWalletAbiSession } from '../walletAbi/WalletAbiSessionContext'
import type { BorrowerFlowState } from '../walletAbi/borrowerStorage'
import type { OfferShort, OfferWithParticipants } from '../types/offers'
import {
  getScriptPubkeyHexFromAddress,
  POLICY_ASSET_ID,
  walletAbiNetworkToP2pkNetwork,
} from '../utility/addressP2pk'
import { mergeBorrowerOffers } from '../utility/borrowerOffers'
import type { TxCreateRequest } from 'wallet-abi-sdk-alpha/schema'

interface ActionState {
  loading: boolean
  error: string | null
  txid: string | null
}

function emptyActionState(): ActionState {
  return {
    loading: false,
    error: null,
    txid: null,
  }
}

function shortId(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

function formatSats(value: bigint): string {
  const asNumber = Number(value)
  if (Number.isSafeInteger(asNumber)) {
    return asNumber.toLocaleString()
  }
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function parseBigIntField(value: string, label: string): bigint {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label} is required`)
  if (!/^\d+$/.test(trimmed)) throw new Error(`${label} must be an integer`)
  return BigInt(trimmed)
}

function parseNumberField(value: string, label: string): number {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label} is required`)
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new Error(`${label} must be a non-negative number`)
  return parsed
}

function Field({
  label,
  children,
  helper,
}: {
  label: string
  children: ReactNode
  helper?: string
}) {
  return (
    <label className="block">
      <span className={formClassNames.label}>{label}</span>
      {children}
      {helper ? <span className={formClassNames.helper}>{helper}</span> : null}
    </label>
  )
}

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string
  title: string
  children: ReactNode
}) {
  return (
    <section className="rounded-[2rem] border border-neutral-200 bg-white p-6 shadow-[0_18px_50px_rgba(0,0,0,0.06)]">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-500">
        {eyebrow}
      </p>
      <h3 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">{title}</h3>
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  )
}

function ActionStatus({ state, esplora }: { state: ActionState; esplora: EsploraClient }) {
  if (state.error) {
    return (
      <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {state.error}
      </p>
    )
  }
  if (state.txid) {
    return (
      <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        Broadcast via wallet:{' '}
        <a
          href={esplora.getTxExplorerUrl(state.txid)}
          target="_blank"
          rel="noreferrer"
          className="font-medium underline"
        >
          {shortId(state.txid)}
        </a>
      </p>
    )
  }
  return null
}

function defaultBorrowerFlowState(): BorrowerFlowState {
  return {
    prepareTxid: null,
    issuanceTxid: null,
  }
}

export function BorrowerPage() {
  const esplora = useMemo(() => new EsploraClient(), [])
  const {
    network,
    signerReceiveAddress,
    signerScriptPubkeyHex,
    signingXOnlyPubkey,
    processRequest,
  } = useWalletAbiSession()

  const [offers, setOffers] = useState<OfferShort[]>([])
  const [offerDetails, setOfferDetails] = useState<Record<string, OfferWithParticipants>>({})
  const [offersLoading, setOffersLoading] = useState(true)
  const [offersError, setOffersError] = useState<string | null>(null)
  const [currentBlockHeight, setCurrentBlockHeight] = useState<number | null>(null)
  const [selectedOffer, setSelectedOffer] = useState<OfferShort | null>(null)
  const [flowState, setFlowState] = useState<BorrowerFlowState>(defaultBorrowerFlowState)
  const [prepareDestinationAddress, setPrepareDestinationAddress] = useState('')
  const [issueDestinationAddress, setIssueDestinationAddress] = useState('')
  const [borrowerDestinationAddress, setBorrowerDestinationAddress] = useState('')
  const [cancelDestinationAddress, setCancelDestinationAddress] = useState('')
  const [repayDestinationAddress, setRepayDestinationAddress] = useState('')
  const [issueCollateralAmount, setIssueCollateralAmount] = useState('25000')
  const [issuePrincipalAmount, setIssuePrincipalAmount] = useState('10000')
  const [issueLoanExpiration, setIssueLoanExpiration] = useState('')
  const [issueInterestPercent, setIssueInterestPercent] = useState('5')
  const [createCollateralAssetId, setCreateCollateralAssetId] = useState('')
  const [createPrincipalAssetId, setCreatePrincipalAssetId] = useState('')
  const [issuancePreviewError, setIssuancePreviewError] = useState<string | null>(null)
  const [issuancePreview, setIssuancePreview] = useState<ReturnType<
    typeof decodeIssuedUtilityNfts
  > | null>(null)
  const [prepareState, setPrepareState] = useState<ActionState>(emptyActionState)
  const [issueState, setIssueState] = useState<ActionState>(emptyActionState)
  const [createState, setCreateState] = useState<ActionState>(emptyActionState)
  const [cancelState, setCancelState] = useState<ActionState>(emptyActionState)
  const [repayState, setRepayState] = useState<ActionState>(emptyActionState)
  const [trackOfferId, setTrackOfferId] = useState('')
  const [trackOfferLoading, setTrackOfferLoading] = useState(false)
  const [trackOfferError, setTrackOfferError] = useState<string | null>(null)
  const [trackOfferSuccess, setTrackOfferSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!signingXOnlyPubkey) return
    setFlowState(loadBorrowerFlowState(signingXOnlyPubkey))
  }, [signingXOnlyPubkey])

  useEffect(() => {
    if (!signingXOnlyPubkey) return
    saveBorrowerFlowState(signingXOnlyPubkey, flowState)
  }, [flowState, signingXOnlyPubkey])

  useEffect(() => {
    if (!signerReceiveAddress) return
    setPrepareDestinationAddress((current) => current || signerReceiveAddress)
    setIssueDestinationAddress((current) => current || signerReceiveAddress)
    setBorrowerDestinationAddress((current) => current || signerReceiveAddress)
    setCancelDestinationAddress((current) => current || signerReceiveAddress)
    setRepayDestinationAddress((current) => current || signerReceiveAddress)
  }, [signerReceiveAddress])

  useEffect(() => {
    if (!network) return
    setCreateCollateralAssetId(
      (current) => current || POLICY_ASSET_ID[walletAbiNetworkToP2pkNetwork(network)]
    )
  }, [network])

  useEffect(() => {
    if (currentBlockHeight == null) return
    setIssueLoanExpiration((current) => current || String(currentBlockHeight + 64))
  }, [currentBlockHeight])

  useEffect(() => {
    const txid = flowState.issuanceTxid?.trim()
    if (!txid) {
      setIssuancePreview(null)
      setIssuancePreviewError(null)
      return
    }
    let cancelled = false
    void esplora
      .getTx(txid)
      .then((tx) => {
        if (cancelled) return
        setIssuancePreview(decodeIssuedUtilityNfts(tx))
        setIssuancePreviewError(null)
      })
      .catch((error) => {
        if (cancelled) return
        setIssuancePreview(null)
        setIssuancePreviewError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      cancelled = true
    }
  }, [esplora, flowState.issuanceTxid])

  const loadOffers = useCallback(async () => {
    if (!network || !signerScriptPubkeyHex || !signingXOnlyPubkey) return
    setOffersLoading(true)
    setOffersError(null)
    try {
      const knownScripts = [
        signerScriptPubkeyHex,
        ...loadKnownWalletScripts(signingXOnlyPubkey, network),
      ]
      let trackedBorrowerOfferIds = loadTrackedBorrowerOfferIds(signingXOnlyPubkey, network)
      const [idsByScript, idsByBorrowerPubkey, tipHeight] = await Promise.all([
        fetchOfferIdsByScripts(knownScripts),
        fetchOfferIdsByBorrowerPubkey(signingXOnlyPubkey),
        esplora.getLatestBlockHeight().catch(() => null),
      ])
      for (const offerId of idsByBorrowerPubkey) {
        trackedBorrowerOfferIds = rememberTrackedBorrowerOfferId(
          signingXOnlyPubkey,
          network,
          offerId
        )
      }
      const borrowerIds = [
        ...new Set([...idsByScript, ...trackedBorrowerOfferIds, ...idsByBorrowerPubkey]),
      ]
      const detailed =
        borrowerIds.length === 0 ? [] : await fetchOfferDetailsBatchWithParticipants(borrowerIds)
      setOffers(
        mergeBorrowerOffers({
          detailedOffers: detailed,
          knownScripts,
          trackedOfferIds: trackedBorrowerOfferIds,
          pendingBorrowerPubkeyOfferIds: idsByBorrowerPubkey,
        })
      )
      setOfferDetails(Object.fromEntries(detailed.map((offer) => [offer.id, offer])))
      setCurrentBlockHeight(tipHeight)
    } catch (error) {
      setOffersError(error instanceof Error ? error.message : String(error))
      setOffers([])
      setOfferDetails({})
    } finally {
      setOffersLoading(false)
    }
  }, [esplora, network, signerScriptPubkeyHex, signingXOnlyPubkey])

  useEffect(() => {
    void loadOffers()
  }, [loadOffers])

  const runBorrowerRequest = useCallback(
    async (
      setState: Dispatch<SetStateAction<ActionState>>,
      buildRequest: () => Promise<TxCreateRequest> | TxCreateRequest,
      onSuccess?: (txid: string) => void
    ) => {
      setState({ loading: true, error: null, txid: null })
      try {
        const request = await buildRequest()
        const result = requireWalletAbiSuccess(await processRequest(request))
        setState({ loading: false, error: null, txid: result.txid })
        onSuccess?.(result.txid)
        void loadOffers()
      } catch (error) {
        setState({
          loading: false,
          error: error instanceof Error ? error.message : String(error),
          txid: null,
        })
      }
    },
    [loadOffers, processRequest]
  )

  const resolveFeeRate = useCallback(() => resolveWalletFeeRateSatKvb(esplora), [esplora])

  const handlePrepare = useCallback(() => {
    if (!network) return
    void runBorrowerRequest(
      setPrepareState,
      async () => {
        const feeRateSatKvb = await resolveFeeRate()
        return buildPrepareUtilityNftsRequest({
          network,
          feeRateSatKvb,
          destinationScriptPubkeyHex: await getScriptPubkeyHexFromAddress(
            prepareDestinationAddress.trim()
          ),
        })
      },
      (txid) => {
        setFlowState({
          prepareTxid: txid,
          issuanceTxid: null,
        })
        setIssueState(emptyActionState())
        setCreateState(emptyActionState())
      }
    )
  }, [network, prepareDestinationAddress, resolveFeeRate, runBorrowerRequest])

  const handleIssue = useCallback(() => {
    if (!network || !flowState.prepareTxid) return
    void runBorrowerRequest(
      setIssueState,
      async () => {
        const feeRateSatKvb = await resolveFeeRate()
        const prepareTx = await esplora.getTx(flowState.prepareTxid!)
        const terms: ProtocolTerms = {
          collateralAmount: parseBigIntField(issueCollateralAmount, 'Collateral amount'),
          principalAmount: parseBigIntField(issuePrincipalAmount, 'Principal amount'),
          loanExpirationTime: parseNumberField(issueLoanExpiration, 'Loan expiration height'),
          principalInterestRate: Math.round(
            parseNumberField(issueInterestPercent, 'Interest percent') * 100
          ),
        }
        return buildIssueUtilityNftsRequest({
          network,
          feeRateSatKvb,
          destinationScriptPubkeyHex: await getScriptPubkeyHexFromAddress(
            issueDestinationAddress.trim()
          ),
          prepareTxid: flowState.prepareTxid!,
          prepareInputUnblindings: resolvePrepareUtilityNftsInputUnblindings({
            network,
            prepareTx,
          }),
          terms,
        })
      },
      (txid) => {
        setFlowState((current) => ({
          ...current,
          issuanceTxid: txid,
        }))
      }
    )
  }, [
    flowState.prepareTxid,
    issueCollateralAmount,
    issueDestinationAddress,
    issueInterestPercent,
    issueLoanExpiration,
    issuePrincipalAmount,
    network,
    resolveFeeRate,
    runBorrowerRequest,
  ])

  const handleCreateOffer = useCallback(() => {
    if (!network || !signerScriptPubkeyHex || !signingXOnlyPubkey || !flowState.issuanceTxid) return
    void runBorrowerRequest(
      setCreateState,
      async () => {
        const feeRateSatKvb = await resolveFeeRate()
        const issuanceTx = await esplora.getTx(flowState.issuanceTxid!)
        return buildCreateOfferRequest({
          network,
          feeRateSatKvb,
          signerScriptPubkeyHex,
          signingXOnlyPubkey,
          issuanceTx,
          collateralAssetId: createCollateralAssetId,
          principalAssetId: createPrincipalAssetId,
          borrowerDestinationScriptPubkeyHex: await getScriptPubkeyHexFromAddress(
            borrowerDestinationAddress.trim()
          ),
        })
      },
      () => {
        clearBorrowerFlowState(signingXOnlyPubkey)
        setFlowState(defaultBorrowerFlowState())
        setIssuancePreview(null)
      }
    )
  }, [
    borrowerDestinationAddress,
    createCollateralAssetId,
    createPrincipalAssetId,
    esplora,
    flowState.issuanceTxid,
    network,
    resolveFeeRate,
    runBorrowerRequest,
    signerScriptPubkeyHex,
    signingXOnlyPubkey,
  ])

  const handleCancelOffer = useCallback(() => {
    if (!network || !selectedOffer) return
    void runBorrowerRequest(setCancelState, async () => {
      const feeRateSatKvb = await resolveFeeRate()
      const offerCreationTx = await esplora.getTx(selectedOffer.created_at_txid)
      return buildCancelOfferRequest({
        network,
        feeRateSatKvb,
        signingXOnlyPubkey: signingXOnlyPubkey!,
        offer: selectedOffer,
        offerCreationTx,
        collateralDestinationScriptPubkeyHex: await getScriptPubkeyHexFromAddress(
          cancelDestinationAddress.trim()
        ),
      })
    })
  }, [
    cancelDestinationAddress,
    esplora,
    network,
    resolveFeeRate,
    runBorrowerRequest,
    selectedOffer,
    signingXOnlyPubkey,
  ])

  const handleRepayLoan = useCallback(() => {
    if (!network || !selectedOffer || !signerScriptPubkeyHex) return
    void runBorrowerRequest(setRepayState, async () => {
      const feeRateSatKvb = await resolveFeeRate()
      const [offerCreationTx, offerUtxos, participantsHistory] = await Promise.all([
        esplora.getTx(selectedOffer.created_at_txid),
        fetchOfferUtxos(selectedOffer.id),
        fetchOfferParticipantsHistory(selectedOffer.id),
      ])
      const lendingUtxo = offerUtxos.find(
        (utxo) => utxo.utxo_type === 'lending' && utxo.spent_txid == null
      )
      if (!lendingUtxo) throw new Error('No active lending output found for this offer')
      const borrowerParticipant = getCurrentBorrowerParticipant(participantsHistory)
      if (!borrowerParticipant) throw new Error('No active borrower participant NFT found')
      const lendingTx = await esplora.getTx(lendingUtxo.txid)
      return buildRepayLoanRequest({
        network,
        feeRateSatKvb,
        signerScriptPubkeyHex,
        offer: selectedOffer,
        offerCreationTx,
        lendingTx,
        borrowerParticipant,
        collateralDestinationScriptPubkeyHex: await getScriptPubkeyHexFromAddress(
          repayDestinationAddress.trim()
        ),
      })
    })
  }, [
    esplora,
    network,
    repayDestinationAddress,
    resolveFeeRate,
    runBorrowerRequest,
    selectedOffer,
    signerScriptPubkeyHex,
  ])

  const handleTrackOffer = useCallback(() => {
    if (!network || !signingXOnlyPubkey) return
    const nextOfferId = trackOfferId.trim().toLowerCase()
    if (nextOfferId.length === 0) {
      setTrackOfferError('Offer ID is required')
      setTrackOfferSuccess(null)
      return
    }

    setTrackOfferLoading(true)
    setTrackOfferError(null)
    setTrackOfferSuccess(null)

    void fetchOfferDetailsBatchWithParticipants([nextOfferId])
      .then((offers) => {
        if (offers.length === 0) {
          throw new Error('Offer not found in the indexer')
        }
        rememberTrackedBorrowerOfferId(signingXOnlyPubkey, network, nextOfferId)
        setTrackOfferId('')
        setTrackOfferSuccess('Tracked borrower offer for this wallet')
        void loadOffers()
      })
      .catch((error) => {
        setTrackOfferError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        setTrackOfferLoading(false)
      })
  }, [loadOffers, network, signingXOnlyPubkey, trackOfferId])

  if (!network || !signerReceiveAddress || !signerScriptPubkeyHex || !signingXOnlyPubkey) {
    return <p className="text-sm text-neutral-600">Waiting for Wallet ABI session.</p>
  }

  const selectedOfferDetail = selectedOffer ? offerDetails[selectedOffer.id] : null

  return (
    <div className="space-y-8">
      <Section eyebrow="Borrower Setup" title="Prepare, issue, and publish offers">
        <p className="text-sm leading-6 text-neutral-600">
          Progress for this borrower flow is stored locally for the connected wallet, so reloads do
          not force you to restart the sequence.
        </p>
        <div className="flex flex-wrap gap-3 text-sm text-neutral-600">
          <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-2">
            Prepare step: {flowState.prepareTxid ? 'saved' : 'not started'}
          </span>
          <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-2">
            Issuance step: {flowState.issuanceTxid ? 'saved' : 'not started'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            clearBorrowerFlowState(signingXOnlyPubkey)
            setFlowState(defaultBorrowerFlowState())
            setPrepareState(emptyActionState())
            setIssueState(emptyActionState())
            setCreateState(emptyActionState())
          }}
          className="rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Reset saved flow
        </button>
      </Section>

      <div className="grid gap-8 xl:grid-cols-3">
        <Section eyebrow="Step 1" title="Prepare issuance outputs">
          <Field label="Destination address">
            <Input
              value={prepareDestinationAddress}
              onChange={(event) => setPrepareDestinationAddress(event.target.value)}
              placeholder="Receive address"
            />
          </Field>
          <p className="text-sm leading-6 text-neutral-600">
            This requests one wallet-funded transaction that creates four 100-sat LBTC outputs for
            the issuance step. Use a receive address from the connected wallet.
          </p>
          <button
            type="button"
            disabled={prepareState.loading || prepareDestinationAddress.trim() === ''}
            onClick={handlePrepare}
            className="rounded-full bg-neutral-950 px-5 py-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
          >
            {prepareState.loading ? 'Submitting…' : 'Prepare utility NFT issuance'}
          </button>
          <ActionStatus state={prepareState} esplora={esplora} />
        </Section>

        <Section eyebrow="Step 2" title="Issue utility NFTs">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Collateral amount">
              <Input
                value={issueCollateralAmount}
                onChange={(event) => setIssueCollateralAmount(event.target.value)}
                suffix="sats"
              />
            </Field>
            <Field label="Principal amount">
              <Input
                value={issuePrincipalAmount}
                onChange={(event) => setIssuePrincipalAmount(event.target.value)}
                suffix="sats"
              />
            </Field>
            <Field label="Loan expiration height">
              <Input
                value={issueLoanExpiration}
                onChange={(event) => setIssueLoanExpiration(event.target.value)}
              />
            </Field>
            <Field label="Interest percent" helper="5 = 5.00%">
              <Input
                value={issueInterestPercent}
                onChange={(event) => setIssueInterestPercent(event.target.value)}
                suffix="%"
              />
            </Field>
          </div>
          <Field label="Destination address">
            <Input
              value={issueDestinationAddress}
              onChange={(event) => setIssueDestinationAddress(event.target.value)}
              placeholder="Receive address"
            />
          </Field>
          <button
            type="button"
            disabled={
              issueState.loading || !flowState.prepareTxid || issueDestinationAddress.trim() === ''
            }
            onClick={handleIssue}
            className="rounded-full bg-neutral-950 px-5 py-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
          >
            {issueState.loading ? 'Submitting…' : 'Issue utility NFTs'}
          </button>
          <ActionStatus state={issueState} esplora={esplora} />
        </Section>

        <Section eyebrow="Step 3" title="Create the offer">
          {issuancePreview ? (
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
              <p className="font-medium text-neutral-900">Decoded issuance parameters</p>
              <p className="mt-2">
                Collateral {formatSats(issuancePreview.terms.collateralAmount)} sats, principal{' '}
                {formatSats(issuancePreview.terms.principalAmount)} sats, interest{' '}
                {(issuancePreview.terms.principalInterestRate / 100).toFixed(2)}%, expiry block{' '}
                {issuancePreview.terms.loanExpirationTime.toLocaleString()}.
              </p>
            </div>
          ) : issuancePreviewError ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {issuancePreviewError}
            </p>
          ) : (
            <p className="text-sm text-neutral-600">
              Complete the issuance step to load the decoded parameters here.
            </p>
          )}
          <Field label="Collateral asset id">
            <Input
              value={createCollateralAssetId}
              onChange={(event) => setCreateCollateralAssetId(event.target.value)}
              className="font-mono"
            />
          </Field>
          <Field label="Principal asset id">
            <Input
              value={createPrincipalAssetId}
              onChange={(event) => setCreatePrincipalAssetId(event.target.value)}
              className="font-mono"
            />
          </Field>
          <Field label="Borrower destination address">
            <Input
              value={borrowerDestinationAddress}
              onChange={(event) => setBorrowerDestinationAddress(event.target.value)}
            />
          </Field>
          <button
            type="button"
            disabled={
              createState.loading ||
              !flowState.issuanceTxid ||
              borrowerDestinationAddress.trim() === '' ||
              createPrincipalAssetId.trim() === '' ||
              createCollateralAssetId.trim() === ''
            }
            onClick={handleCreateOffer}
            className="rounded-full bg-neutral-950 px-5 py-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
          >
            {createState.loading ? 'Submitting…' : 'Create offer'}
          </button>
          <ActionStatus state={createState} esplora={esplora} />
        </Section>
      </div>

      <Section eyebrow="Borrower Offers" title="Your indexed borrower positions">
        <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-4 md:flex-row md:items-end">
          <Field
            label="Track existing borrower offer"
            helper="Use this once for accepted or repaid offers that were created before local borrower tracking was added."
          >
            <Input
              value={trackOfferId}
              onChange={(event) => setTrackOfferId(event.target.value)}
              placeholder="Offer ID"
            />
          </Field>
          <button
            type="button"
            onClick={handleTrackOffer}
            disabled={trackOfferLoading}
            className="rounded-full border border-neutral-300 bg-white px-5 py-3 text-sm font-medium text-neutral-800 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:bg-neutral-200"
          >
            {trackOfferLoading ? 'Tracking…' : 'Track offer'}
          </button>
        </div>
        {trackOfferError ? (
          <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {trackOfferError}
          </p>
        ) : null}
        {trackOfferSuccess ? (
          <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {trackOfferSuccess}
          </p>
        ) : null}
        <OfferTable
          offers={offers}
          loading={offersLoading}
          error={offersError}
          currentBlockHeight={currentBlockHeight}
          onRetry={() => void loadOffers()}
          emptyMessage="No borrower offers found for this wallet"
          onOfferClick={(offer) => {
            setSelectedOffer(offer)
            setCancelState(emptyActionState())
            setRepayState(emptyActionState())
          }}
        />
      </Section>

      {selectedOffer && (
        <Section eyebrow="Selected Offer" title={shortId(selectedOffer.id)}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
              <p className="font-medium text-neutral-900">Status</p>
              <p className="mt-2 capitalize">{selectedOffer.status}</p>
            </div>
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
              <p className="font-medium text-neutral-900">Terms</p>
              <p className="mt-2">
                Collateral {formatSats(selectedOffer.collateral_amount)} sats, principal{' '}
                {formatSats(selectedOffer.principal_amount)} sats, interest{' '}
                {(selectedOffer.interest_rate / 100).toFixed(2)}%.
              </p>
            </div>
          </div>

          {selectedOffer.status === 'pending' && (
            <div className="space-y-4">
              <Field label="Collateral return address">
                <Input
                  value={cancelDestinationAddress}
                  onChange={(event) => setCancelDestinationAddress(event.target.value)}
                />
              </Field>
              <button
                type="button"
                disabled={
                  cancelState.loading ||
                  cancelDestinationAddress.trim() === '' ||
                  !selectedOfferDetail
                }
                onClick={handleCancelOffer}
                className="rounded-full bg-neutral-950 px-5 py-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                {cancelState.loading ? 'Submitting…' : 'Cancel offer'}
              </button>
              <ActionStatus state={cancelState} esplora={esplora} />
            </div>
          )}

          {selectedOffer.status === 'active' && (
            <div className="space-y-4">
              <Field label="Collateral return address">
                <Input
                  value={repayDestinationAddress}
                  onChange={(event) => setRepayDestinationAddress(event.target.value)}
                />
              </Field>
              <button
                type="button"
                disabled={repayState.loading || repayDestinationAddress.trim() === ''}
                onClick={handleRepayLoan}
                className="rounded-full bg-neutral-950 px-5 py-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                {repayState.loading ? 'Submitting…' : 'Repay loan'}
              </button>
              <ActionStatus state={repayState} esplora={esplora} />
            </div>
          )}

          {selectedOffer.status !== 'pending' && selectedOffer.status !== 'active' && (
            <p className="text-sm text-neutral-600">
              This offer does not have a borrower-side action in the web client.
            </p>
          )}
        </Section>
      )}
    </div>
  )
}
