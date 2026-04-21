import { useCallback, useEffect, useMemo, useState } from 'react'
import { RouteScaffold } from './RouteScaffold'
import { ActionStateCard, ConnectionGate, PrimaryButton, SectionCard } from './RouteWidgets'
import { useWalletAbiSession } from '../walletAbi/session'
import { useWalletAbiActionRunner } from '../walletAbi/actionRunner'
import {
  createAcceptOfferRequest,
  createClaimLenderPrincipalRequest,
  createLiquidateLoanRequest,
} from '../walletAbi/requests'
import {
  fetchOfferDetailsBatchWithParticipants,
  fetchOfferIdsByScript,
  fetchOffers,
  fetchOfferUtxos,
} from '../api/client'
import { EsploraClient } from '../api/esplora'
import { getScriptPubkeyHexFromAddress } from '../utility/addressP2pk'
import { OfferTable } from '../components/OfferTable'
import type { OfferShort } from '../types/offers'
import {
  loadLenderFlowState,
  trackLenderOfferId,
  trackLenderScriptPubkey,
} from '../walletAbi/storage'

export function LenderRoute() {
  const session = useWalletAbiSession()
  const requestAction = useWalletAbiActionRunner()
  const esplora = useMemo(() => new EsploraClient(), [])

  const [supplyOffers, setSupplyOffers] = useState<OfferShort[]>([])
  const [pendingOffers, setPendingOffers] = useState<OfferShort[]>([])
  const [loadingSupply, setLoadingSupply] = useState(false)
  const [loadingPending, setLoadingPending] = useState(false)
  const [supplyError, setSupplyError] = useState<string | null>(null)
  const [pendingError, setPendingError] = useState<string | null>(null)
  const [currentBlockHeight, setCurrentBlockHeight] = useState<number | null>(null)
  const [selectedOffer, setSelectedOffer] = useState<OfferShort | null>(null)
  const [selectedScope, setSelectedScope] = useState<'pending' | 'supply' | null>(null)

  const connected = session.status === 'connected' && Boolean(session.receiveAddress)
  const lenderIdentity = session.signingXOnlyPubkey ?? session.receiveAddress

  const loadSupplyOffers = useCallback(async () => {
    if (!session.receiveAddress) {
      setSupplyOffers([])
      setLoadingSupply(false)
      return
    }

    setLoadingSupply(true)
    setSupplyError(null)

    try {
      const scriptPubkeyHex = await getScriptPubkeyHexFromAddress(session.receiveAddress)
      const lenderState = trackLenderScriptPubkey(lenderIdentity, scriptPubkeyHex)
      const scriptPubkeys = [
        ...new Set(
          [scriptPubkeyHex, ...lenderState.scriptPubkeys].map((script) => script.toLowerCase())
        ),
      ]

      const [idsByScript, height, activeOffers] = await Promise.all([
        Promise.all(scriptPubkeys.map((script) => fetchOfferIdsByScript(script))),
        esplora.getLatestBlockHeight().catch(() => null),
        fetchOffers({ status: 'active', limit: 20, offset: 0 }).catch(() => []),
      ])
      const storedOfferIds = loadLenderFlowState(lenderIdentity).offerIds
      const ids = [...new Set([...idsByScript.flat(), ...storedOfferIds])]
      const withParticipants =
        ids.length === 0 ? [] : await fetchOfferDetailsBatchWithParticipants(ids)

      const scriptSet = new Set(scriptPubkeys)
      const offerById = new Map<string, OfferShort>()
      for (const offer of withParticipants) {
        const isKnownLender = offer.participants.some(
          (participant) =>
            participant.participant_type === 'lender' &&
            scriptSet.has(participant.script_pubkey.trim().toLowerCase())
        )
        if (isKnownLender || storedOfferIds.includes(offer.id)) {
          offerById.set(offer.id, offer)
        }
      }

      if (offerById.size === 0 && height != null) {
        for (const offer of activeOffers) {
          if (offer.loan_expiration_time <= height) {
            offerById.set(offer.id, offer)
          }
        }
      }

      setSupplyOffers([...offerById.values()])
      setCurrentBlockHeight(height)
    } catch (nextError) {
      setSupplyError(nextError instanceof Error ? nextError.message : String(nextError))
      setSupplyOffers([])
    } finally {
      setLoadingSupply(false)
    }
  }, [esplora, lenderIdentity, session.receiveAddress])

  const loadPendingOffers = useCallback(async () => {
    setLoadingPending(true)
    setPendingError(null)

    try {
      const [offers, height] = await Promise.all([
        fetchOffers({ status: 'pending', limit: 20, offset: 0 }),
        esplora.getLatestBlockHeight().catch(() => null),
      ])
      setPendingOffers(offers)
      setCurrentBlockHeight((current) => current ?? height)
    } catch (nextError) {
      setPendingError(nextError instanceof Error ? nextError.message : String(nextError))
      setPendingOffers([])
    } finally {
      setLoadingPending(false)
    }
  }, [esplora])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => {
      if (!cancelled) void loadSupplyOffers()
    })
    return () => {
      cancelled = true
    }
  }, [loadSupplyOffers])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => {
      if (!cancelled) void loadPendingOffers()
    })
    return () => {
      cancelled = true
    }
  }, [loadPendingOffers])

  const offerExpired =
    selectedOffer != null &&
    currentBlockHeight != null &&
    selectedOffer.loan_expiration_time <= currentBlockHeight

  return (
    <RouteScaffold
      eyebrow="Lender"
      title="Accept offers and resolve active loans."
      description="Accept pending offers, claim repaid principal, or liquidate after expiry."
    >
      <div className="grid gap-10 xl:grid-cols-[minmax(0,1.55fr)_20rem]">
        <div className="space-y-5">
          <SectionCard
            title="Your Supply"
            description="Offers associated with the connected wallet."
          >
            <OfferTable
              offers={supplyOffers}
              loading={loadingSupply}
              error={supplyError}
              currentBlockHeight={currentBlockHeight}
              onRetry={loadSupplyOffers}
              emptyMessage="No lender offers discovered for this wallet."
              onOfferClick={(offer) => {
                setSelectedScope('supply')
                setSelectedOffer(offer)
              }}
            />
          </SectionCard>

          <SectionCard title="Pending Offers" description="Select a pending offer to fund.">
            <OfferTable
              offers={pendingOffers}
              loading={loadingPending}
              error={pendingError}
              currentBlockHeight={currentBlockHeight}
              onRetry={loadPendingOffers}
              emptyMessage="No pending offers are available right now."
              onOfferClick={(offer) => {
                setSelectedScope('pending')
                setSelectedOffer(offer)
              }}
            />
          </SectionCard>

          <SectionCard
            title="Selected Offer"
            description="Build the next lender request for the selected offer."
          >
            <ConnectionGate connected={connected}>
              {selectedOffer ? (
                <div className="space-y-4 text-sm text-stone-700">
                  <div className="break-all font-mono text-stone-950">{selectedOffer.id}</div>
                  <p>Status: {selectedOffer.status}</p>
                  <p>Created Txid: {selectedOffer.created_at_txid}</p>

                  <div className="flex flex-wrap gap-3">
                    <PrimaryButton
                      disabled={
                        requestAction.action.status === 'running' ||
                        selectedScope !== 'pending' ||
                        offerExpired
                      }
                      onClick={() =>
                        requestAction.run(
                          'accept offer',
                          async () => {
                            const lenderAddress = session.receiveAddress!
                            const lenderScriptPubkey =
                              await getScriptPubkeyHexFromAddress(lenderAddress)
                            trackLenderScriptPubkey(lenderIdentity, lenderScriptPubkey)
                            const offerCreationTx = await esplora.getTx(
                              selectedOffer.created_at_txid
                            )
                            return createAcceptOfferRequest({
                              offer: selectedOffer,
                              offerCreationTx,
                              lenderAddress,
                            })
                          },
                          async () => {
                            trackLenderOfferId(lenderIdentity, selectedOffer.id)
                            await loadSupplyOffers()
                            await loadPendingOffers()
                          }
                        )
                      }
                    >
                      Accept Pending Offer
                    </PrimaryButton>

                    <PrimaryButton
                      disabled={
                        requestAction.action.status === 'running' ||
                        selectedScope !== 'supply' ||
                        selectedOffer.status !== 'repaid'
                      }
                      onClick={() =>
                        requestAction.run(
                          'claim lender principal',
                          async () => {
                            const offerUtxos = await fetchOfferUtxos(selectedOffer.id)
                            const repaymentUtxo = offerUtxos.find(
                              (utxo) => utxo.utxo_type === 'repayment' && utxo.spent_txid == null
                            )
                            const lendingUtxo = [...offerUtxos]
                              .reverse()
                              .find((utxo) => utxo.utxo_type === 'lending')
                            if (!repaymentUtxo || !lendingUtxo) {
                              throw new Error(
                                'Required repayment or lending transaction not found.'
                              )
                            }

                            const [repaymentTx, lendingTx] = await Promise.all([
                              esplora.getTx(repaymentUtxo.txid),
                              esplora.getTx(lendingUtxo.txid),
                            ])

                            return createClaimLenderPrincipalRequest({
                              offer: selectedOffer,
                              repaymentTx,
                              lenderAddress: session.receiveAddress!,
                              lenderNftAssetId: String(lendingTx.vout?.[5]?.asset ?? ''),
                            })
                          },
                          async () => {
                            await loadSupplyOffers()
                          }
                        )
                      }
                    >
                      Claim Repaid Principal
                    </PrimaryButton>

                    <PrimaryButton
                      disabled={
                        requestAction.action.status === 'running' ||
                        selectedScope !== 'supply' ||
                        selectedOffer.status !== 'active' ||
                        !offerExpired
                      }
                      onClick={() =>
                        requestAction.run(
                          'liquidate loan',
                          async () => {
                            const offerUtxos = await fetchOfferUtxos(selectedOffer.id)
                            const lendingUtxo = offerUtxos.find(
                              (utxo) => utxo.utxo_type === 'lending' && utxo.spent_txid == null
                            )
                            if (!lendingUtxo) {
                              throw new Error('No active lending transaction found for this offer.')
                            }
                            const lendingTx = await esplora.getTx(lendingUtxo.txid)
                            return createLiquidateLoanRequest({
                              offer: selectedOffer,
                              lendingTx,
                              lenderAddress: session.receiveAddress!,
                              lenderNftAssetId: String(lendingTx.vout?.[5]?.asset ?? ''),
                            })
                          },
                          async () => {
                            await loadSupplyOffers()
                          }
                        )
                      }
                    >
                      Liquidate After Expiry
                    </PrimaryButton>
                  </div>
                </div>
              ) : (
                <p className="text-sm leading-7 text-stone-600">
                  Select an offer from either table to build the next lender-side request.
                </p>
              )}
            </ConnectionGate>
          </SectionCard>
        </div>

        <ActionStateCard action={requestAction.action} />
      </div>
    </RouteScaffold>
  )
}
