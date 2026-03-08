import { useCallback, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import {
  fetchOfferDetailsBatchWithParticipants,
  fetchOfferIdsByScripts,
  fetchOfferParticipantsHistory,
  fetchOfferUtxos,
  fetchOffers,
  filterOffersByParticipantScripts,
  getCurrentLenderParticipant,
} from '../api/client'
import { EsploraClient } from '../api/esplora'
import { OfferTable } from '../components/OfferTable'
import { Input } from '../components/Input'
import { formClassNames } from '../components/formClassNames'
import { requireWalletAbiSuccess } from '../walletAbi/response'
import {
  buildAcceptOfferRequest,
  buildClaimRepaidPrincipalRequest,
  buildLiquidateLoanRequest,
} from '../walletAbi/requestBuilders'
import { useWalletAbiSession } from '../walletAbi/WalletAbiSessionContext'
import {
  loadTrackedLenderOfferIds,
  rememberTrackedLenderOfferId,
} from '../walletAbi/lenderStorage'
import { loadKnownWalletScripts } from '../walletAbi/walletScriptStorage'
import type { OfferShort, OfferWithParticipants } from '../types/offers'
import { getScriptPubkeyHexFromAddress } from '../utility/addressP2pk'
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
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-500">{eyebrow}</p>
      <h3 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">{title}</h3>
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  )
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

function ActionStatus({
  state,
  esplora,
}: {
  state: ActionState
  esplora: EsploraClient
}) {
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

export function LenderPage() {
  const esplora = useMemo(() => new EsploraClient(), [])
  const { network, signerReceiveAddress, signerScriptPubkeyHex, signingXOnlyPubkey, processRequest } =
    useWalletAbiSession()

  const [supplyOffers, setSupplyOffers] = useState<OfferShort[]>([])
  const [pendingOffers, setPendingOffers] = useState<OfferShort[]>([])
  const [pendingOfferDetails, setPendingOfferDetails] = useState<Record<string, OfferWithParticipants>>({})
  const [supplyLoading, setSupplyLoading] = useState(true)
  const [pendingLoading, setPendingLoading] = useState(true)
  const [supplyError, setSupplyError] = useState<string | null>(null)
  const [pendingError, setPendingError] = useState<string | null>(null)
  const [currentBlockHeight, setCurrentBlockHeight] = useState<number | null>(null)
  const [selectedOffer, setSelectedOffer] = useState<OfferShort | null>(null)
  const [acceptBorrowerDestinationAddress, setAcceptBorrowerDestinationAddress] = useState('')
  const [claimDestinationAddress, setClaimDestinationAddress] = useState('')
  const [liquidationDestinationAddress, setLiquidationDestinationAddress] = useState('')
  const [acceptState, setAcceptState] = useState<ActionState>(emptyActionState)
  const [claimState, setClaimState] = useState<ActionState>(emptyActionState)
  const [liquidationState, setLiquidationState] = useState<ActionState>(emptyActionState)
  const [trackOfferId, setTrackOfferId] = useState('')
  const [trackOfferLoading, setTrackOfferLoading] = useState(false)
  const [trackOfferError, setTrackOfferError] = useState<string | null>(null)
  const [trackOfferSuccess, setTrackOfferSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!signerReceiveAddress) return
    setClaimDestinationAddress((current) => current || signerReceiveAddress)
    setLiquidationDestinationAddress((current) => current || signerReceiveAddress)
  }, [signerReceiveAddress])

  const loadSupplyOffers = useCallback(async () => {
    if (!network || !signerScriptPubkeyHex || !signingXOnlyPubkey) return
    setSupplyLoading(true)
    setSupplyError(null)
    try {
      const knownScripts = [
        signerScriptPubkeyHex,
        ...loadKnownWalletScripts(signingXOnlyPubkey, network),
      ]
      const trackedOfferIds = loadTrackedLenderOfferIds(signingXOnlyPubkey, network)
      const [offerIdsByScript, tipHeight] = await Promise.all([
        fetchOfferIdsByScripts(knownScripts),
        esplora.getLatestBlockHeight().catch(() => null),
      ])
      const offerIds = [...new Set([...offerIdsByScript, ...trackedOfferIds])]
      const detailed =
        offerIds.length === 0 ? [] : await fetchOfferDetailsBatchWithParticipants(offerIds)
      const byScript = filterOffersByParticipantScripts(detailed, knownScripts, 'lender')
      const byScriptIds = new Set(byScript.map((offer) => offer.id))
      const trackedOffers = detailed
        .filter((offer) => trackedOfferIds.includes(offer.id) && !byScriptIds.has(offer.id))
        .map(({ participants, ...offer }) => {
          void participants
          return offer
        })
      setSupplyOffers([...byScript, ...trackedOffers])
      setCurrentBlockHeight(tipHeight)
    } catch (error) {
      setSupplyError(error instanceof Error ? error.message : String(error))
      setSupplyOffers([])
    } finally {
      setSupplyLoading(false)
    }
  }, [esplora, network, signerScriptPubkeyHex, signingXOnlyPubkey])

  const loadPendingOffers = useCallback(async () => {
    setPendingLoading(true)
    setPendingError(null)
    try {
      const pending = await fetchOffers({ status: 'pending', limit: 10, offset: 0 })
      const detailed =
        pending.length === 0
          ? []
          : await fetchOfferDetailsBatchWithParticipants(pending.map((offer) => offer.id))
      setPendingOffers(pending)
      setPendingOfferDetails(Object.fromEntries(detailed.map((offer) => [offer.id, offer])))
    } catch (error) {
      setPendingError(error instanceof Error ? error.message : String(error))
      setPendingOffers([])
      setPendingOfferDetails({})
    } finally {
      setPendingLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSupplyOffers()
  }, [loadSupplyOffers])

  useEffect(() => {
    void loadPendingOffers()
  }, [loadPendingOffers])

  const runLenderRequest = useCallback(
    async (
      setState: Dispatch<SetStateAction<ActionState>>,
      buildRequest: () => Promise<TxCreateRequest>,
      afterSuccess?: () => void
    ) => {
      setState({ loading: true, error: null, txid: null })
      try {
        const request = await buildRequest()
        const result = requireWalletAbiSuccess(await processRequest(request))
        setState({ loading: false, error: null, txid: result.txid })
        afterSuccess?.()
        void Promise.all([loadSupplyOffers(), loadPendingOffers()])
      } catch (error) {
        setState({
          loading: false,
          error: error instanceof Error ? error.message : String(error),
          txid: null,
        })
      }
    },
    [loadPendingOffers, loadSupplyOffers, processRequest]
  )

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
        rememberTrackedLenderOfferId(signingXOnlyPubkey, network, nextOfferId)
        setTrackOfferId('')
        setTrackOfferSuccess('Tracked offer for this wallet')
        void loadSupplyOffers()
      })
      .catch((error) => {
        setTrackOfferError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        setTrackOfferLoading(false)
      })
  }, [loadSupplyOffers, network, signingXOnlyPubkey, trackOfferId])

  const handleAccept = useCallback(() => {
    if (!network || !signingXOnlyPubkey || !signerScriptPubkeyHex || !selectedOffer) return
    const detailedOffer = pendingOfferDetails[selectedOffer.id]
    void runLenderRequest(setAcceptState, async () => {
      if (!detailedOffer) {
        throw new Error('Pending offer details are not loaded yet')
      }
      const offerCreationTx = await esplora.getTx(selectedOffer.created_at_txid)
      return buildAcceptOfferRequest({
        network,
        signerScriptPubkeyHex,
        offer: selectedOffer,
        offerCreationTx,
        borrowerOutputScriptPubkeyHex:
          acceptBorrowerDestinationAddress.trim() === ''
            ? undefined
            : await getScriptPubkeyHexFromAddress(acceptBorrowerDestinationAddress.trim()),
      })
    }, () => {
      rememberTrackedLenderOfferId(signingXOnlyPubkey, network, selectedOffer.id)
      setTrackOfferSuccess('Tracked accepted offer for this wallet')
      setTrackOfferError(null)
    })
  }, [
    acceptBorrowerDestinationAddress,
    esplora,
    network,
    pendingOfferDetails,
    runLenderRequest,
    selectedOffer,
    signerScriptPubkeyHex,
    signingXOnlyPubkey,
  ])

  const handleClaim = useCallback(() => {
    if (!network || !signerScriptPubkeyHex || !selectedOffer) return
    void runLenderRequest(setClaimState, async () => {
      const [offerCreationTx, offerUtxos, participantsHistory] = await Promise.all([
        esplora.getTx(selectedOffer.created_at_txid),
        fetchOfferUtxos(selectedOffer.id),
        fetchOfferParticipantsHistory(selectedOffer.id),
      ])
      const repaymentUtxo = offerUtxos.find(
        (utxo) => utxo.utxo_type === 'repayment' && utxo.spent_txid == null
      )
      if (!repaymentUtxo) throw new Error('No unspent repayment output found')
      const lenderParticipant = getCurrentLenderParticipant(participantsHistory)
      if (!lenderParticipant) throw new Error('No active lender NFT found')
      return buildClaimRepaidPrincipalRequest({
        network,
        signerScriptPubkeyHex,
        offer: selectedOffer,
        offerCreationTx,
        repaymentTxid: repaymentUtxo.txid,
        repaymentVout: repaymentUtxo.vout,
        lenderParticipant,
        principalDestinationScriptPubkeyHex: await getScriptPubkeyHexFromAddress(
          claimDestinationAddress.trim()
        ),
      })
    })
  }, [
    claimDestinationAddress,
    esplora,
    network,
    runLenderRequest,
    selectedOffer,
    signerScriptPubkeyHex,
  ])

  const handleLiquidate = useCallback(() => {
    if (!network || !signerScriptPubkeyHex || !selectedOffer) return
    void runLenderRequest(setLiquidationState, async () => {
      const [offerCreationTx, offerUtxos, participantsHistory] = await Promise.all([
        esplora.getTx(selectedOffer.created_at_txid),
        fetchOfferUtxos(selectedOffer.id),
        fetchOfferParticipantsHistory(selectedOffer.id),
      ])
      const lendingUtxo = offerUtxos.find(
        (utxo) => utxo.utxo_type === 'lending' && utxo.spent_txid == null
      )
      if (!lendingUtxo) throw new Error('No active lending output found')
      const lenderParticipant = getCurrentLenderParticipant(participantsHistory)
      if (!lenderParticipant) throw new Error('No active lender NFT found')
      const lendingTx = await esplora.getTx(lendingUtxo.txid)
      return buildLiquidateLoanRequest({
        network,
        signerScriptPubkeyHex,
        offer: selectedOffer,
        offerCreationTx,
        lendingTx,
        lenderParticipant,
        collateralDestinationScriptPubkeyHex: await getScriptPubkeyHexFromAddress(
          liquidationDestinationAddress.trim()
        ),
      })
    })
  }, [
    esplora,
    liquidationDestinationAddress,
    network,
    runLenderRequest,
    selectedOffer,
    signerScriptPubkeyHex,
  ])

  if (!network || !signerReceiveAddress || !signerScriptPubkeyHex || !signingXOnlyPubkey) {
    return <p className="text-sm text-neutral-600">Waiting for Wallet ABI session.</p>
  }

  const offerExpired =
    selectedOffer != null &&
    currentBlockHeight != null &&
    selectedOffer.loan_expiration_time <= currentBlockHeight

  return (
    <div className="space-y-8">
      <Section eyebrow="Lender View" title="Accept, claim, or liquidate with Wallet ABI">
        <p className="text-sm leading-6 text-neutral-600">
          Supply actions use the public indexer for offer state and hand the final transaction
          request to the paired wallet. The browser never enumerates private wallet balances.
        </p>
      </Section>

      <Section eyebrow="Your Supply" title="Offers where this wallet is the lender">
        <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-4 md:flex-row md:items-end">
          <Field
            label="Track existing lender offer"
            helper="Use this once for offers accepted before local lender tracking was added."
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
          offers={supplyOffers}
          loading={supplyLoading}
          error={supplyError}
          currentBlockHeight={currentBlockHeight}
          onRetry={() => void loadSupplyOffers()}
          emptyMessage="No supply positions found for this wallet"
          onOfferClick={(offer) => {
            setSelectedOffer(offer)
            setAcceptBorrowerDestinationAddress('')
            setAcceptState(emptyActionState())
            setClaimState(emptyActionState())
            setLiquidationState(emptyActionState())
          }}
        />
      </Section>

      <Section eyebrow="Pending Offers" title="Offers available to accept">
        <OfferTable
          offers={pendingOffers}
          loading={pendingLoading}
          error={pendingError}
          currentBlockHeight={currentBlockHeight}
          onRetry={() => void loadPendingOffers()}
          emptyMessage="No pending offers"
          onOfferClick={(offer) => {
            setSelectedOffer(offer)
            setAcceptBorrowerDestinationAddress('')
            setAcceptState(emptyActionState())
            setClaimState(emptyActionState())
            setLiquidationState(emptyActionState())
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
              <p className="text-sm leading-6 text-neutral-600">
                Accepting the offer creates the lending covenant, sends the principal to the
                borrower destination recorded in the offer, and returns the lender NFT to your
                current wallet receive script.
              </p>
              <Field
                label="Borrower destination address"
                helper="Leave empty for offers that already embed the full borrower script. Enter it manually for hash-only offers."
              >
                <Input
                  value={acceptBorrowerDestinationAddress}
                  onChange={(event) => setAcceptBorrowerDestinationAddress(event.target.value)}
                  placeholder="Borrower receive address"
                />
              </Field>
              <button
                type="button"
                disabled={acceptState.loading || !pendingOfferDetails[selectedOffer.id]}
                onClick={handleAccept}
                className="rounded-full bg-neutral-950 px-5 py-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                {acceptState.loading ? 'Submitting…' : 'Accept offer'}
              </button>
              <ActionStatus state={acceptState} esplora={esplora} />
            </div>
          )}

          {selectedOffer.status === 'repaid' && (
            <div className="space-y-4">
              <Field label="Principal destination address">
                <Input
                  value={claimDestinationAddress}
                  onChange={(event) => setClaimDestinationAddress(event.target.value)}
                />
              </Field>
              <button
                type="button"
                disabled={claimState.loading || claimDestinationAddress.trim() === ''}
                onClick={handleClaim}
                className="rounded-full bg-neutral-950 px-5 py-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                {claimState.loading ? 'Submitting…' : 'Claim repaid principal'}
              </button>
              <ActionStatus state={claimState} esplora={esplora} />
            </div>
          )}

          {selectedOffer.status === 'active' && offerExpired && (
            <div className="space-y-4">
              <Field label="Collateral destination address">
                <Input
                  value={liquidationDestinationAddress}
                  onChange={(event) => setLiquidationDestinationAddress(event.target.value)}
                />
              </Field>
              <button
                type="button"
                disabled={liquidationState.loading || liquidationDestinationAddress.trim() === ''}
                onClick={handleLiquidate}
                className="rounded-full bg-neutral-950 px-5 py-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                {liquidationState.loading ? 'Submitting…' : 'Liquidate expired loan'}
              </button>
              <ActionStatus state={liquidationState} esplora={esplora} />
            </div>
          )}

          {(selectedOffer.status === 'active' && !offerExpired) ||
          (selectedOffer.status !== 'pending' &&
            selectedOffer.status !== 'repaid' &&
            !(selectedOffer.status === 'active' && offerExpired)) ? (
            <p className="text-sm text-neutral-600">
              No lender action is available for this offer in its current state.
            </p>
          ) : null}
        </Section>
      )}
    </div>
  )
}
