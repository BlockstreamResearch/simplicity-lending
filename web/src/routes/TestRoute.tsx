import { useEffect, useMemo, useState } from 'react'
import { RouteScaffold } from './RouteScaffold'
import {
  ActionStateCard,
  ConnectionGate,
  FieldInput,
  FieldLabel,
  FieldTextarea,
  PrimaryButton,
  SectionCard,
} from './RouteWidgets'
import { useWalletAbiSession } from '../walletAbi/session'
import { useWalletAbiActionRunner } from '../walletAbi/actionRunner'
import { useBorrowerFlowState } from '../walletAbi/useBorrowerFlowState'
import {
  createAssetAuthCreateRequest,
  createIssueUtilityNftsRequest,
  createPrepareUtilityRequest,
  createPreLockRequest,
  createScriptAuthCreateRequest,
} from '../walletAbi/requests'
import { parseExplicitOutputsFromTxHex } from '../walletAbi/transactions'
import { formatJson } from '../walletAbi/format'

interface HashState {
  principalAssetId: string
  collateralAmount: string
  principalAmount: string
  loanExpirationTime: string
  interestPercent: string
  scriptAuthScriptHex: string
  scriptAuthAmount: string
  assetAuthAssetIdHex: string
  assetAuthAmount: string
  rawEnvelopeText: string
}

function encodeHashState(state: HashState): string {
  const json = JSON.stringify(state)
  return btoa(unescape(encodeURIComponent(json)))
}

function decodeHashState(raw: string): HashState | null {
  try {
    const json = decodeURIComponent(escape(atob(raw)))
    return JSON.parse(json) as HashState
  } catch {
    return null
  }
}

export function TestRoute() {
  const session = useWalletAbiSession()
  const requestAction = useWalletAbiActionRunner()
  const borrowerState = useBorrowerFlowState(session.receiveAddress)
  const connected =
    session.status === 'connected' &&
    Boolean(session.receiveAddress) &&
    Boolean(session.signingXOnlyPubkey)

  const initialHashState = useMemo(() => {
    if (typeof window === 'undefined') {
      return null
    }
    const encoded = window.location.hash.replace(/^#/, '')
    return encoded ? decodeHashState(encoded) : null
  }, [])

  const [principalAssetId, setPrincipalAssetId] = useState(initialHashState?.principalAssetId ?? '')
  const [collateralAmount, setCollateralAmount] = useState(
    initialHashState?.collateralAmount ?? borrowerState.state.collateralAmount ?? ''
  )
  const [principalAmount, setPrincipalAmount] = useState(
    initialHashState?.principalAmount ?? borrowerState.state.principalAmount ?? ''
  )
  const [loanExpirationTime, setLoanExpirationTime] = useState(
    initialHashState?.loanExpirationTime ??
      (borrowerState.state.loanExpirationTime != null
        ? String(borrowerState.state.loanExpirationTime)
        : '')
  )
  const [interestPercent, setInterestPercent] = useState(
    initialHashState?.interestPercent ??
      (borrowerState.state.interestRateBasisPoints != null
        ? (borrowerState.state.interestRateBasisPoints / 100).toFixed(2)
        : '')
  )
  const [scriptAuthScriptHex, setScriptAuthScriptHex] = useState(
    initialHashState?.scriptAuthScriptHex ?? ''
  )
  const [scriptAuthAmount, setScriptAuthAmount] = useState(initialHashState?.scriptAuthAmount ?? '1000')
  const [assetAuthAssetIdHex, setAssetAuthAssetIdHex] = useState(
    initialHashState?.assetAuthAssetIdHex ?? ''
  )
  const [assetAuthAmount, setAssetAuthAmount] = useState(initialHashState?.assetAuthAmount ?? '1000')
  const [rawEnvelopeText, setRawEnvelopeText] = useState(
    initialHashState?.rawEnvelopeText ??
      JSON.stringify(
        {
          id: 1,
          jsonrpc: '2.0',
          method: 'wallet_abi_process_request',
          params: {},
        },
        null,
        2
      )
  )
  const [identityResponse, setIdentityResponse] = useState<string>('No identity call submitted yet.\n')
  const [transcript, setTranscript] = useState<string[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const nextHash = encodeHashState({
      principalAssetId,
      collateralAmount,
      principalAmount,
      loanExpirationTime,
      interestPercent,
      scriptAuthScriptHex,
      scriptAuthAmount,
      assetAuthAssetIdHex,
      assetAuthAmount,
      rawEnvelopeText,
    })

    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${nextHash}`)
  }, [
    assetAuthAmount,
    assetAuthAssetIdHex,
    collateralAmount,
    interestPercent,
    loanExpirationTime,
    principalAmount,
    principalAssetId,
    rawEnvelopeText,
    scriptAuthAmount,
    scriptAuthScriptHex,
  ])

  const appendTranscript = (entry: string) => {
    setTranscript((current) => [`${new Date().toISOString()} ${entry}`, ...current].slice(0, 24))
  }

  return (
    <RouteScaffold
      eyebrow="Testing"
      title="Exercise Wallet ABI requests directly from the browser."
      description="Use this route to verify identity methods, replay raw JSON-RPC envelopes, and run a compact set of preset Wallet ABI requests without leaving the app."
    >
      <div className="grid gap-10 xl:grid-cols-[minmax(0,1.55fr)_20rem]">
        <div className="space-y-5">
          <SectionCard
            title="Session Status"
            description="The Blockstream wallet session topic, receive address, and signing pubkey are all exposed here so the request order can be verified before submitting transactions."
          >
            <dl className="grid gap-4 text-sm text-stone-700 md:grid-cols-2">
              <div>
                <dt className="font-semibold text-stone-500">Status</dt>
                <dd className="mt-1 font-mono text-stone-950">{session.status}</dd>
              </div>
              <div>
                <dt className="font-semibold text-stone-500">Topic</dt>
                <dd className="mt-1 break-all font-mono text-stone-950">
                  {session.sessionTopic ?? 'No active topic'}
                </dd>
              </div>
              <div className="md:col-span-2">
                <dt className="font-semibold text-stone-500">Receive Address</dt>
                <dd className="mt-1 break-all font-mono text-stone-950">
                  {session.receiveAddress ?? 'Not connected'}
                </dd>
              </div>
              <div className="md:col-span-2">
                <dt className="font-semibold text-stone-500">X-Only Pubkey</dt>
                <dd className="mt-1 break-all font-mono text-stone-950">
                  {session.signingXOnlyPubkey ?? 'Not connected'}
                </dd>
              </div>
            </dl>

            <div className="mt-5 flex flex-wrap gap-3">
              <PrimaryButton
                disabled={!connected}
                onClick={async () => {
                  const [address, pubkey] = await Promise.all([
                    session.getSignerReceiveAddress(),
                    session.getRawSigningXOnlyPubkey(),
                  ])
                  setIdentityResponse(
                    formatJson({
                      get_signer_receive_address: address.value,
                      get_raw_signing_x_only_pubkey: pubkey.value,
                    })
                  )
                  appendTranscript('Fetched wallet identity methods.')
                }}
              >
                Run Getter Methods
              </PrimaryButton>
            </div>

            <pre className="mt-5 overflow-x-auto rounded-2xl bg-stone-950 p-4 text-xs leading-6 text-stone-100">
              {identityResponse}
            </pre>
          </SectionCard>

          <SectionCard
            title="Preset Requests"
            description="These buttons build and submit representative utility, auth, and pre-lock requests. The exact request JSON is captured in the panel on the right."
          >
            <ConnectionGate connected={connected}>
              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-4 rounded-[1.5rem] border border-neutral-200 p-4">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Utility
                  </p>
                  <PrimaryButton
                    className="w-full"
                    disabled={!session.receiveAddress || requestAction.action.status === 'running'}
                    onClick={() =>
                      requestAction.run(
                        'test prepare utility',
                        () => createPrepareUtilityRequest({ recipientAddress: session.receiveAddress! }),
                        async ({ meta, txId, txHex }) => {
                          if (!txId || !txHex || !meta) {
                            return
                          }
                          const outputs = await parseExplicitOutputsFromTxHex(txHex)
                          borrowerState.patch({
                            prepareTxId: txId,
                            auxiliaryAssetId: outputs[0]?.assetId ?? null,
                            issuanceEntropyHex: meta.issuanceEntropyHex,
                          })
                          appendTranscript(`Prepared utility asset ${outputs[0]?.assetId ?? 'unknown'}.`)
                        }
                      )
                    }
                  >
                    Prepare Utility Asset
                  </PrimaryButton>
                  <PrimaryButton
                    className="w-full"
                    disabled={
                      !session.receiveAddress ||
                      !borrowerState.state.prepareTxId ||
                      !borrowerState.state.auxiliaryAssetId ||
                      !borrowerState.state.issuanceEntropyHex ||
                      requestAction.action.status === 'running'
                    }
                    onClick={() =>
                      requestAction.run(
                        'test issue utility NFTs',
                        () =>
                          createIssueUtilityNftsRequest({
                            recipientAddress: session.receiveAddress!,
                            prepareTxId: borrowerState.state.prepareTxId!,
                            auxiliaryAssetId: borrowerState.state.auxiliaryAssetId!,
                            issuanceEntropyHex: borrowerState.state.issuanceEntropyHex!,
                            collateralAmount: BigInt(collateralAmount),
                            principalAmount: BigInt(principalAmount),
                            loanExpirationTime: Number(loanExpirationTime),
                            interestPercent: Number(interestPercent),
                          }),
                        async ({ txId, txHex }) => {
                          if (!txId || !txHex) {
                            return
                          }
                          const outputs = await parseExplicitOutputsFromTxHex(txHex)
                          borrowerState.patch({
                            issuanceTxId: txId,
                            firstParametersNftAssetId: outputs[0]?.assetId ?? null,
                            secondParametersNftAssetId: outputs[1]?.assetId ?? null,
                            borrowerNftAssetId: outputs[2]?.assetId ?? null,
                            lenderNftAssetId: outputs[3]?.assetId ?? null,
                            collateralAmount,
                            principalAmount,
                            loanExpirationTime: Number(loanExpirationTime),
                            interestRateBasisPoints: Math.round(Number(interestPercent) * 100),
                          })
                          appendTranscript('Issued utility NFT request from test route.')
                        }
                      )
                    }
                  >
                    Issue Utility NFTs
                  </PrimaryButton>
                </div>

                <div className="space-y-4 rounded-[1.5rem] border border-neutral-200 p-4">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Covenant Auth
                  </p>
                  <div>
                    <FieldLabel>Script Auth Target Script Hex</FieldLabel>
                    <FieldInput
                      value={scriptAuthScriptHex}
                      onChange={(event) => setScriptAuthScriptHex(event.target.value)}
                      placeholder="0014..."
                    />
                  </div>
                  <div>
                    <FieldLabel>Lock Amount (sat)</FieldLabel>
                    <FieldInput
                      value={scriptAuthAmount}
                      onChange={(event) => setScriptAuthAmount(event.target.value)}
                    />
                  </div>
                  <PrimaryButton
                    className="w-full"
                    disabled={requestAction.action.status === 'running'}
                    onClick={() =>
                      requestAction.run('test script-auth lock', () =>
                        createScriptAuthCreateRequest({
                          scriptHex: scriptAuthScriptHex,
                          amountSat: BigInt(scriptAuthAmount),
                        })
                      )
                    }
                  >
                    Create ScriptAuth Lock
                  </PrimaryButton>

                  <div className="pt-2">
                    <FieldLabel>Asset Auth NFT Asset Id</FieldLabel>
                    <FieldInput
                      value={assetAuthAssetIdHex}
                      onChange={(event) => setAssetAuthAssetIdHex(event.target.value)}
                      placeholder="64-char asset id"
                    />
                  </div>
                  <div>
                    <FieldLabel>Locked Amount (sat)</FieldLabel>
                    <FieldInput
                      value={assetAuthAmount}
                      onChange={(event) => setAssetAuthAmount(event.target.value)}
                    />
                  </div>
                  <PrimaryButton
                    className="w-full"
                    disabled={requestAction.action.status === 'running'}
                    onClick={() =>
                      requestAction.run('test asset-auth lock', () =>
                        createAssetAuthCreateRequest({
                          authAssetIdHex: assetAuthAssetIdHex,
                          lockedAmountSat: BigInt(assetAuthAmount),
                          withAssetBurn: true,
                        })
                      )
                    }
                  >
                    Create AssetAuth Lock
                  </PrimaryButton>
                </div>

                <div className="space-y-4 rounded-[1.5rem] border border-neutral-200 p-4 md:col-span-2">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Pre-Lock
                  </p>
                  <div>
                    <FieldLabel>Principal Asset Id</FieldLabel>
                    <FieldInput
                      value={principalAssetId}
                      onChange={(event) => setPrincipalAssetId(event.target.value)}
                      placeholder="64-char asset id"
                    />
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <FieldLabel>Collateral Amount</FieldLabel>
                      <FieldInput
                        value={collateralAmount}
                        onChange={(event) => setCollateralAmount(event.target.value)}
                      />
                    </div>
                    <div>
                      <FieldLabel>Principal Amount</FieldLabel>
                      <FieldInput
                        value={principalAmount}
                        onChange={(event) => setPrincipalAmount(event.target.value)}
                      />
                    </div>
                    <div>
                      <FieldLabel>Expiration Height</FieldLabel>
                      <FieldInput
                        value={loanExpirationTime}
                        onChange={(event) => setLoanExpirationTime(event.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <FieldLabel>Interest Percent</FieldLabel>
                    <FieldInput
                      value={interestPercent}
                      onChange={(event) => setInterestPercent(event.target.value)}
                    />
                  </div>
                  <PrimaryButton
                    className="w-full"
                    disabled={
                      requestAction.action.status === 'running' ||
                      !session.signingXOnlyPubkey ||
                      !borrowerState.state.firstParametersNftAssetId ||
                      !borrowerState.state.secondParametersNftAssetId ||
                      !borrowerState.state.borrowerNftAssetId ||
                      !borrowerState.state.lenderNftAssetId
                    }
                    onClick={() =>
                      requestAction.run('test pre-lock create', () =>
                        createPreLockRequest({
                          borrowerAddress: session.receiveAddress!,
                          principalAssetId,
                          borrowerPubkeyHex: session.signingXOnlyPubkey!,
                          firstParametersNftAssetId: borrowerState.state.firstParametersNftAssetId!,
                          secondParametersNftAssetId: borrowerState.state.secondParametersNftAssetId!,
                          borrowerNftAssetId: borrowerState.state.borrowerNftAssetId!,
                          lenderNftAssetId: borrowerState.state.lenderNftAssetId!,
                          collateralAmount: BigInt(collateralAmount),
                          principalAmount: BigInt(principalAmount),
                          loanExpirationTime: Number(loanExpirationTime),
                          interestRateBasisPoints: Math.round(Number(interestPercent) * 100),
                        })
                      )
                    }
                  >
                    Create Pre-Lock Request
                  </PrimaryButton>
                </div>
              </div>
            </ConnectionGate>
          </SectionCard>

          <SectionCard
            title="Raw JSON-RPC Envelope"
            description="Paste any Wallet ABI JSON-RPC envelope here to send it through the active WalletConnect session without using the typed client helpers."
          >
            <ConnectionGate connected={connected}>
              <FieldTextarea
                value={rawEnvelopeText}
                onChange={(event) => setRawEnvelopeText(event.target.value)}
                className="min-h-56 font-mono text-xs"
              />
              <div className="mt-5 flex flex-wrap gap-3">
                <PrimaryButton
                  disabled={requestAction.action.status === 'running'}
                  onClick={async () => {
                    const envelope = JSON.parse(rawEnvelopeText) as Parameters<
                      typeof session.sendRawEnvelope
                    >[0]
                    const response = await session.sendRawEnvelope(envelope)
                    setIdentityResponse(formatJson(response))
                    appendTranscript(`Sent raw envelope ${String(envelope.method)}.`)
                  }}
                >
                  Send Raw Envelope
                </PrimaryButton>
              </div>
            </ConnectionGate>
          </SectionCard>

          <SectionCard
            title="Response Transcript"
            description="Every request and getter call appends a short timestamped entry so multi-step test sequences can be replayed without leaving the page."
          >
            <div className="space-y-2 text-sm leading-7 text-stone-700">
              {transcript.length === 0 ? (
                <p>No transcript entries yet.</p>
              ) : (
                transcript.map((entry) => (
                  <div key={entry} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                    {entry}
                  </div>
                ))
              )}
            </div>
          </SectionCard>
        </div>

        <ActionStateCard action={requestAction.action} />
      </div>
    </RouteScaffold>
  )
}
