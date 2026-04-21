import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { RouteScaffold } from './RouteScaffold'
import {
  ActionStateCard,
  ConnectionGate,
  FieldInput,
  FieldLabel,
  PrimaryButton,
  SectionCard,
} from './RouteWidgets'
import { useWalletAbiSession } from '../walletAbi/session'
import { useBorrowerFlowState } from '../walletAbi/useBorrowerFlowState'
import { useWalletAbiActionRunner } from '../walletAbi/actionRunner'
import {
  createCancelPreLockRequest,
  createPreLockRequest,
  createRepayLoanRequest,
} from '../walletAbi/requests'
import {
  fetchOfferDetailsBatchWithParticipants,
  fetchOfferIdsByBorrowerPubkey,
  fetchOfferIdsByScript,
  fetchOfferUtxos,
  filterOffersByParticipantRole,
} from '../api/client'
import { EsploraClient } from '../api/esplora'
import { getScriptPubkeyHexFromAddress } from '../utility/addressP2pk'
import { OfferTable } from '../components/OfferTable'
import type { OfferShort } from '../types/offers'

function summarizeSetup(state: ReturnType<typeof useBorrowerFlowState>['state']) {
  if (
    !state.firstParametersNftAssetId ||
    !state.secondParametersNftAssetId ||
    !state.borrowerNftAssetId ||
    !state.lenderNftAssetId
  ) {
    return 'Utility preparation is incomplete.'
  }

  return 'Utility preparation is ready.'
}

export function BorrowerRoute() {
  const [searchParams] = useSearchParams()
  const session = useWalletAbiSession()
  const borrowerState = useBorrowerFlowState(session.receiveAddress)
  const requestAction = useWalletAbiActionRunner()
  const esplora = useMemo(() => new EsploraClient(), [])
  const requestedOfferId = searchParams.get('offer')

  const [principalAssetId, setPrincipalAssetId] = useState('')
  const [offers, setOffers] = useState<OfferShort[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentBlockHeight, setCurrentBlockHeight] = useState<number | null>(null)
  const [selectedOffer, setSelectedOffer] = useState<OfferShort | null>(null)

  const connected =
    session.status === 'connected' &&
    Boolean(session.receiveAddress) &&
    Boolean(session.signingXOnlyPubkey)

  const loadOffers = useCallback(async () => {
    if (!session.receiveAddress || !session.signingXOnlyPubkey) {
      setOffers([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const scriptPubkeyHex = await getScriptPubkeyHexFromAddress(session.receiveAddress)
      const [idsByScript, idsByBorrowerPubkey, height] = await Promise.all([
        fetchOfferIdsByScript(scriptPubkeyHex),
        fetchOfferIdsByBorrowerPubkey(session.signingXOnlyPubkey),
        esplora.getLatestBlockHeight().catch(() => null),
      ])

      const mergedIds = [...new Set([...idsByScript, ...idsByBorrowerPubkey])]
      const offersWithParticipants =
        mergedIds.length === 0 ? [] : await fetchOfferDetailsBatchWithParticipants(mergedIds)

      const borrowerByScript = filterOffersByParticipantRole(
        offersWithParticipants,
        scriptPubkeyHex,
        'borrower'
      )
      const borrowerByScriptIds = new Set(borrowerByScript.map((offer) => offer.id))
      const pendingByPubkey = offersWithParticipants
        .filter(
          (offer) =>
            idsByBorrowerPubkey.includes(offer.id) && !borrowerByScriptIds.has(offer.id)
        )
        .map(({ participants, ...offer }) => {
          void participants
          return offer
        })

      setOffers([...borrowerByScript, ...pendingByPubkey])
      setCurrentBlockHeight(height)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
      setOffers([])
    } finally {
      setLoading(false)
    }
  }, [esplora, session.receiveAddress, session.signingXOnlyPubkey])

  useEffect(() => {
    void loadOffers()
  }, [loadOffers])

  useEffect(() => {
    if (!requestedOfferId) return
    const requestedOffer = offers.find((offer) => offer.id === requestedOfferId)
    if (requestedOffer && selectedOffer?.id !== requestedOffer.id) {
      setSelectedOffer(requestedOffer)
    }
  }, [offers, requestedOfferId, selectedOffer?.id])

  return (
    <RouteScaffold
      eyebrow="Borrower"
      title="Create, cancel, and repay offers."
      description="Create pre-lock offers, cancel pending offers, and repay active loans from the connected wallet."
    >
      <div className="grid gap-10 xl:grid-cols-[minmax(0,1.55fr)_20rem]">
        <div className="space-y-5">
          <SectionCard
            title="Offer Setup"
            description="Prepare the utility NFTs on the Utility route, then submit the pre-lock request here."
          >
            <ConnectionGate connected={connected}>
              <div className="space-y-4">
                <p className="text-sm leading-7 text-stone-700">
                  {summarizeSetup(borrowerState.state)}{' '}
                  <Link
                    to="/utility"
                    className="font-semibold text-stone-950 underline"
                  >
                    Open Utility
                  </Link>{' '}
                  to prepare and issue the borrower, lender, and parameter NFTs.
                </p>

                <dl className="grid gap-3 text-sm text-stone-700 md:grid-cols-2">
                  <div>
                    <dt className="font-semibold text-stone-500">First Parameter NFT</dt>
                    <dd className="mt-1 break-all font-mono text-stone-950">
                      {borrowerState.state.firstParametersNftAssetId ?? 'Missing'}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-stone-500">Second Parameter NFT</dt>
                    <dd className="mt-1 break-all font-mono text-stone-950">
                      {borrowerState.state.secondParametersNftAssetId ?? 'Missing'}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-stone-500">Borrower NFT</dt>
                    <dd className="mt-1 break-all font-mono text-stone-950">
                      {borrowerState.state.borrowerNftAssetId ?? 'Missing'}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-stone-500">Lender NFT</dt>
                    <dd className="mt-1 break-all font-mono text-stone-950">
                      {borrowerState.state.lenderNftAssetId ?? 'Missing'}
                    </dd>
                  </div>
                </dl>

                <div>
                  <FieldLabel>Principal Asset Id</FieldLabel>
                  <FieldInput
                    value={principalAssetId}
                    onChange={(event) => setPrincipalAssetId(event.target.value)}
                    placeholder="64-char asset id"
                  />
                </div>

                <PrimaryButton
                  disabled={
                    requestAction.action.status === 'running' ||
                    !session.signingXOnlyPubkey ||
                    !borrowerState.state.firstParametersNftAssetId ||
                    !borrowerState.state.secondParametersNftAssetId ||
                    !borrowerState.state.borrowerNftAssetId ||
                    !borrowerState.state.lenderNftAssetId ||
                    !borrowerState.state.collateralAmount ||
                    !borrowerState.state.principalAmount ||
                    borrowerState.state.loanExpirationTime == null ||
                    borrowerState.state.interestRateBasisPoints == null
                  }
                  onClick={() =>
                    requestAction.run(
                      'create pre-lock',
                      () =>
                        createPreLockRequest({
                          borrowerAddress: session.receiveAddress!,
                          principalAssetId,
                          borrowerPubkeyHex: session.signingXOnlyPubkey!,
                          firstParametersNftAssetId: borrowerState.state.firstParametersNftAssetId!,
                          secondParametersNftAssetId: borrowerState.state.secondParametersNftAssetId!,
                          borrowerNftAssetId: borrowerState.state.borrowerNftAssetId!,
                          lenderNftAssetId: borrowerState.state.lenderNftAssetId!,
                          collateralAmount: BigInt(borrowerState.state.collateralAmount!),
                          principalAmount: BigInt(borrowerState.state.principalAmount!),
                          loanExpirationTime: borrowerState.state.loanExpirationTime!,
                          interestRateBasisPoints: borrowerState.state.interestRateBasisPoints!,
                        }),
                      async () => {
                        await loadOffers()
                      }
                    )
                  }
                >
                  Submit Pre-Lock Request
                </PrimaryButton>
              </div>
            </ConnectionGate>
          </SectionCard>

          <SectionCard
            title="My Borrower Offers"
            description="Select an offer to cancel or repay."
          >
            <OfferTable
              offers={offers}
              loading={loading}
              error={error}
              currentBlockHeight={currentBlockHeight}
              onRetry={loadOffers}
              emptyMessage="No borrower offers discovered for this wallet."
              onOfferClick={(offer) => setSelectedOffer(offer)}
            />
          </SectionCard>

          <SectionCard
            title="Selected Offer"
            description="Build the next request for the selected offer."
          >
            {selectedOffer ? (
              <div className="space-y-4 text-sm text-stone-700">
                <div className="break-all font-mono text-stone-950">{selectedOffer.id}</div>
                <p>Status: {selectedOffer.status}</p>
                <p>Created Txid: {selectedOffer.created_at_txid}</p>
                <div className="flex flex-wrap gap-3">
                  <PrimaryButton
                    disabled={requestAction.action.status === 'running' || selectedOffer.status !== 'pending'}
                    onClick={() =>
                      requestAction.run(
                        'cancel pre-lock',
                        async () => {
                          const offerCreationTx = await esplora.getTx(selectedOffer.created_at_txid)
                          return createCancelPreLockRequest({
                            offer: selectedOffer,
                            offerCreationTx,
                            borrowerAddress: session.receiveAddress!,
                            borrowerPubkeyHex: session.signingXOnlyPubkey!,
                          })
                        },
                        async () => {
                          await loadOffers()
                        }
                      )
                    }
                  >
                    Cancel Pending Offer
                  </PrimaryButton>

                  <PrimaryButton
                    disabled={requestAction.action.status === 'running' || selectedOffer.status !== 'active'}
                    onClick={() =>
                      requestAction.run(
                        'repay loan',
                        async () => {
                          const offerUtxos = await fetchOfferUtxos(selectedOffer.id)
                          const activeLendingUtxo = offerUtxos.find(
                            (utxo) => utxo.utxo_type === 'lending' && utxo.spent_txid == null
                          )
                          if (!activeLendingUtxo) {
                            throw new Error('No active lending UTXO found for this offer.')
                          }

                          const lendingTx = await esplora.getTx(activeLendingUtxo.txid)
                          return createRepayLoanRequest({
                            offer: selectedOffer,
                            lendingTx,
                            borrowerAddress: session.receiveAddress!,
                          })
                        },
                        async () => {
                          await loadOffers()
                        }
                      )
                    }
                  >
                    Repay Active Loan
                  </PrimaryButton>
                </div>
              </div>
            ) : (
              <p className="text-sm leading-7 text-stone-600">
                Select an offer from the table above to prepare a cancellation or repayment request.
              </p>
            )}
          </SectionCard>
        </div>

        <ActionStateCard action={requestAction.action} />
      </div>
    </RouteScaffold>
  )
}
