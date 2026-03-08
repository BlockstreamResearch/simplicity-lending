import { useCallback, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import type { TxCreateRequest } from 'wallet-abi-sdk-alpha/schema'
import { EsploraClient } from '../api/esplora'
import { Input } from '../components/Input'
import { formClassNames } from '../components/formClassNames'
import { getScriptPubkeyHexFromAddress, POLICY_ASSET_ID, walletAbiNetworkToP2pkNetwork } from '../utility/addressP2pk'
import { requireWalletAbiSuccess } from '../walletAbi/response'
import {
  buildDemoIssueAssetRequest,
  buildDemoReissueAssetRequest,
  buildDemoSplitRequest,
  buildDemoTransferRequest,
  deriveDemoIssuedAssetFromTx,
} from '../walletAbi/utilityRequests'
import {
  clearDemoIssuedAssets,
  loadDemoIssuedAssets,
  removeDemoIssuedAsset,
  upsertDemoIssuedAsset,
  type DemoIssuedAssetRecord,
} from '../walletAbi/utilityStorage'
import { useWalletAbiSession } from '../walletAbi/WalletAbiSessionContext'

interface ActionState {
  loading: boolean
  error: string | null
  txid: string | null
}

interface IssueActionState extends ActionState {
  issuedAsset: DemoIssuedAssetRecord | null
}

function emptyActionState(): ActionState {
  return {
    loading: false,
    error: null,
    txid: null,
  }
}

function emptyIssueActionState(): IssueActionState {
  return {
    ...emptyActionState(),
    issuedAsset: null,
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  return String(error)
}

function shortId(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

function parsePositiveSafeInteger(value: string, label: string): number {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`${label} is required`)
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${label} must be a positive integer`)
  }

  const parsed = Number(trimmed)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive safe integer`)
  }

  return parsed
}

function formatSats(value: string | number): string {
  const asNumber = typeof value === 'number' ? value : Number(value)
  if (Number.isSafeInteger(asNumber)) {
    return asNumber.toLocaleString()
  }
  return String(value)
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString()
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

function ExplorerLink({
  href,
  label,
}: {
  href: string
  label: string
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium underline">
      {label}
    </a>
  )
}

function ActionStatus({
  state,
  esplora,
  children,
}: {
  state: ActionState
  esplora: EsploraClient
  children?: ReactNode
}) {
  if (!state.error && !state.txid && !children) {
    return null
  }

  return (
    <div className="space-y-3">
      {state.txid ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Broadcast via wallet:{' '}
          <ExplorerLink href={esplora.getTxExplorerUrl(state.txid)} label={shortId(state.txid)} />
        </p>
      ) : null}
      {state.error ? (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      {children}
    </div>
  )
}

export function UtilityPage() {
  const esplora = useMemo(() => new EsploraClient(), [])
  const {
    network,
    signerReceiveAddress,
    signingXOnlyPubkey,
    processRequest,
  } = useWalletAbiSession()

  const policyAssetId = useMemo(() => {
    if (!network) return ''
    return POLICY_ASSET_ID[walletAbiNetworkToP2pkNetwork(network)]
  }, [network])

  const [issuedAssets, setIssuedAssets] = useState<DemoIssuedAssetRecord[]>([])
  const [selectedIssuedAssetId, setSelectedIssuedAssetId] = useState('')

  const [transferDestinationAddress, setTransferDestinationAddress] = useState('')
  const [transferAssetId, setTransferAssetId] = useState('')
  const [transferAmountSat, setTransferAmountSat] = useState('100')

  const [splitDestinationAddress, setSplitDestinationAddress] = useState('')
  const [splitAssetId, setSplitAssetId] = useState('')
  const [splitParts, setSplitParts] = useState('4')
  const [splitPartAmountSat, setSplitPartAmountSat] = useState('100')

  const [issueLabel, setIssueLabel] = useState('')
  const [issueDestinationAddress, setIssueDestinationAddress] = useState('')
  const [issueAmountSat, setIssueAmountSat] = useState('1000')

  const [reissueDestinationAddress, setReissueDestinationAddress] = useState('')
  const [reissueAmountSat, setReissueAmountSat] = useState('1000')

  const [transferState, setTransferState] = useState<ActionState>(emptyActionState)
  const [splitState, setSplitState] = useState<ActionState>(emptyActionState)
  const [issueState, setIssueState] = useState<IssueActionState>(emptyIssueActionState)
  const [reissueState, setReissueState] = useState<ActionState>(emptyActionState)

  useEffect(() => {
    if (!network || !signingXOnlyPubkey) {
      setIssuedAssets([])
      setSelectedIssuedAssetId('')
      return
    }
    setIssuedAssets(loadDemoIssuedAssets(signingXOnlyPubkey, network))
  }, [network, signingXOnlyPubkey])

  useEffect(() => {
    if (!signerReceiveAddress) return
    setTransferDestinationAddress((current) => current || signerReceiveAddress)
    setSplitDestinationAddress((current) => current || signerReceiveAddress)
    setIssueDestinationAddress((current) => current || signerReceiveAddress)
    setReissueDestinationAddress((current) => current || signerReceiveAddress)
  }, [signerReceiveAddress])

  useEffect(() => {
    if (!policyAssetId) return
    setTransferAssetId((current) => current || policyAssetId)
    setSplitAssetId((current) => current || policyAssetId)
  }, [policyAssetId])

  useEffect(() => {
    if (issuedAssets.length === 0) {
      setSelectedIssuedAssetId('')
      return
    }
    setSelectedIssuedAssetId((current) =>
      current && issuedAssets.some((asset) => asset.assetId === current)
        ? current
        : issuedAssets[0].assetId,
    )
  }, [issuedAssets])

  const selectedIssuedAsset = useMemo(
    () => issuedAssets.find((asset) => asset.assetId === selectedIssuedAssetId) ?? null,
    [issuedAssets, selectedIssuedAssetId],
  )

  const runAction = useCallback(
    async (
      setState: Dispatch<SetStateAction<ActionState>>,
      buildRequest: () => Promise<TxCreateRequest>,
    ) => {
      setState({ loading: true, error: null, txid: null })
      try {
        const request = await buildRequest()
        const result = requireWalletAbiSuccess(await processRequest(request))
        setState({ loading: false, error: null, txid: result.txid })
      } catch (error) {
        setState({
          loading: false,
          error: errorMessage(error),
          txid: null,
        })
      }
    },
    [processRequest],
  )

  const handleForgetAsset = useCallback(
    (assetId: string) => {
      if (!network || !signingXOnlyPubkey) return
      const nextAssets = removeDemoIssuedAsset(signingXOnlyPubkey, network, assetId)
      setIssuedAssets(nextAssets)
      if (selectedIssuedAssetId === assetId) {
        setSelectedIssuedAssetId(nextAssets[0]?.assetId ?? '')
      }
    },
    [network, selectedIssuedAssetId, signingXOnlyPubkey],
  )

  const handleClearAssets = useCallback(() => {
    if (!network || !signingXOnlyPubkey) return
    clearDemoIssuedAssets(signingXOnlyPubkey, network)
    setIssuedAssets([])
    setSelectedIssuedAssetId('')
  }, [network, signingXOnlyPubkey])

  const handleTransfer = useCallback(() => {
    if (!network) return
    void runAction(setTransferState, async () =>
      buildDemoTransferRequest({
        network,
        recipientScriptPubkeyHex: await getScriptPubkeyHexFromAddress(
          transferDestinationAddress.trim(),
        ),
        assetId: transferAssetId.trim() || undefined,
        amountSat: parsePositiveSafeInteger(transferAmountSat, 'Transfer amount'),
      }),
    )
  }, [network, runAction, transferAmountSat, transferAssetId, transferDestinationAddress])

  const handleSplit = useCallback(() => {
    if (!network) return
    void runAction(setSplitState, async () =>
      buildDemoSplitRequest({
        network,
        destinationScriptPubkeyHex: await getScriptPubkeyHexFromAddress(
          splitDestinationAddress.trim(),
        ),
        assetId: splitAssetId.trim() || undefined,
        splitParts: parsePositiveSafeInteger(splitParts, 'Split parts'),
        partAmountSat: parsePositiveSafeInteger(splitPartAmountSat, 'Split part amount'),
      }),
    )
  }, [network, runAction, splitAssetId, splitDestinationAddress, splitPartAmountSat, splitParts])

  const handleIssue = useCallback(() => {
    if (!network || !signingXOnlyPubkey) return
    setIssueState({
      loading: true,
      error: null,
      txid: null,
      issuedAsset: null,
    })

    void (async () => {
      try {
        const destinationScriptPubkeyHex = await getScriptPubkeyHexFromAddress(
          issueDestinationAddress.trim(),
        )
        const label = issueLabel.trim() || `Demo Asset ${issuedAssets.length + 1}`
        const parsedIssueAmountSat = parsePositiveSafeInteger(issueAmountSat, 'Issue amount')
        const { request, contractHash } = buildDemoIssueAssetRequest({
          network,
          destinationScriptPubkeyHex,
          issueAmountSat: parsedIssueAmountSat,
        })
        const result = requireWalletAbiSuccess(await processRequest(request))

        try {
          const derived = await deriveDemoIssuedAssetFromTx({
            txHex: result.txHex,
            contractHash,
          })
          const issuedAsset: DemoIssuedAssetRecord = {
            label,
            network,
            assetId: derived.assetId,
            reissuanceTokenId: derived.reissuanceTokenId,
            assetEntropy: derived.assetEntropy,
            contractHash: derived.contractHash,
            issuancePrevout: derived.issuancePrevout,
            issueTxid: result.txid,
            issueAmountSat: String(parsedIssueAmountSat),
            createdAt: new Date().toISOString(),
          }

          const nextAssets = upsertDemoIssuedAsset(signingXOnlyPubkey, network, issuedAsset)
          setIssuedAssets(nextAssets)
          setSelectedIssuedAssetId(issuedAsset.assetId)
          setTransferAssetId(issuedAsset.assetId)
          setSplitAssetId(issuedAsset.assetId)
          setIssueState({
            loading: false,
            error: null,
            txid: result.txid,
            issuedAsset,
          })
        } catch (deriveError) {
          setIssueState({
            loading: false,
            error: `Transaction broadcast, but local issue metadata could not be derived: ${errorMessage(
              deriveError,
            )}`,
            txid: result.txid,
            issuedAsset: null,
          })
        }
      } catch (error) {
        setIssueState({
          loading: false,
          error: errorMessage(error),
          txid: null,
          issuedAsset: null,
        })
      }
    })()
  }, [
    issueAmountSat,
    issueDestinationAddress,
    issueLabel,
    issuedAssets.length,
    network,
    processRequest,
    signingXOnlyPubkey,
  ])

  const handleReissue = useCallback(() => {
    if (!network || !selectedIssuedAsset) return
    void runAction(setReissueState, async () =>
      buildDemoReissueAssetRequest({
        network,
        destinationScriptPubkeyHex: await getScriptPubkeyHexFromAddress(
          reissueDestinationAddress.trim(),
        ),
        reissuanceTokenId: selectedIssuedAsset.reissuanceTokenId,
        assetEntropy: selectedIssuedAsset.assetEntropy,
        reissueAmountSat: parsePositiveSafeInteger(reissueAmountSat, 'Reissue amount'),
      }),
    )
  }, [network, reissueAmountSat, reissueDestinationAddress, runAction, selectedIssuedAsset])

  return (
    <div className="space-y-8">
      <section className="rounded-[2rem] border border-neutral-200 bg-[linear-gradient(135deg,#eaf4ff_0%,#ffffff_52%,#f7f4ec_100%)] p-8 shadow-[0_24px_80px_rgba(0,0,0,0.07)]">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-neutral-500">
              Utility Demo
            </p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight text-neutral-950">
              Issue, reissue, transfer, and split assets with Wallet ABI.
            </h2>
            <p className="mt-4 text-base leading-7 text-neutral-600">
              This mirrors the CLI basic commands for demo use inside the browser. Issued asset
              metadata is saved locally per connected wallet and network so reissuance can reuse it.
            </p>
          </div>
          <div className="grid gap-3 text-sm text-neutral-700 sm:grid-cols-2">
            <div className="rounded-[1.5rem] border border-neutral-200 bg-white/90 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-500">
                Network
              </p>
              <p className="mt-2 font-medium text-neutral-900">{network ?? 'unknown'}</p>
            </div>
            <div className="rounded-[1.5rem] border border-neutral-200 bg-white/90 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-500">
                Policy Asset
              </p>
              <p className="mt-2 break-all font-mono text-xs text-neutral-900">
                {policyAssetId ? (
                  <ExplorerLink
                    href={esplora.getAssetExplorerUrl(policyAssetId)}
                    label={shortId(policyAssetId)}
                  />
                ) : (
                  'unknown'
                )}
              </p>
            </div>
          </div>
        </div>
        <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Utility outputs are created as explicit demo outputs. That keeps the page simple and the
          resulting transactions easy to inspect on the explorer.
        </p>
      </section>

      <Section eyebrow="Registry" title="Saved issued assets">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm leading-6 text-neutral-600">
            Issued assets are stored in browser local storage for the connected signer so you can
            reissue them later without manually copying entropy and token ids.
          </p>
          <button
            type="button"
            onClick={handleClearAssets}
            disabled={issuedAssets.length === 0}
            className="rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear saved assets
          </button>
        </div>
        {issuedAssets.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-4 text-sm text-neutral-600">
            No issued demo assets saved yet. Issue one below to enable reissuance shortcuts.
          </p>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {issuedAssets.map((asset) => {
              const selected = asset.assetId === selectedIssuedAssetId
              return (
                <article
                  key={asset.assetId}
                  className={`rounded-[1.5rem] border p-5 ${
                    selected
                      ? 'border-neutral-950 bg-neutral-950 text-white'
                      : 'border-neutral-200 bg-neutral-50 text-neutral-900'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p
                        className={`text-xs font-semibold uppercase tracking-[0.24em] ${
                          selected ? 'text-neutral-300' : 'text-neutral-500'
                        }`}
                      >
                        {asset.label}
                      </p>
                      <p className="mt-2 text-lg font-semibold">{shortId(asset.assetId, 14, 10)}</p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        selected ? 'bg-white/10 text-white' : 'bg-white text-neutral-600'
                      }`}
                    >
                      {formatSats(asset.issueAmountSat)} sats
                    </span>
                  </div>
                  <div className="mt-4 space-y-2 text-xs">
                    <p>
                      Asset:{' '}
                      <ExplorerLink
                        href={esplora.getAssetExplorerUrl(asset.assetId)}
                        label={shortId(asset.assetId)}
                      />
                    </p>
                    <p>
                      Reissue token:{' '}
                      <ExplorerLink
                        href={esplora.getAssetExplorerUrl(asset.reissuanceTokenId)}
                        label={shortId(asset.reissuanceTokenId)}
                      />
                    </p>
                    <p>
                      Issue tx:{' '}
                      <ExplorerLink
                        href={esplora.getTxExplorerUrl(asset.issueTxid)}
                        label={shortId(asset.issueTxid)}
                      />
                    </p>
                    <p className={selected ? 'text-neutral-300' : 'text-neutral-600'}>
                      Saved {formatDateTime(asset.createdAt)}
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setTransferAssetId(asset.assetId)
                        setSelectedIssuedAssetId(asset.assetId)
                      }}
                      className={`rounded-full px-4 py-2 text-sm font-medium ${
                        selected
                          ? 'bg-white text-neutral-950 hover:bg-neutral-100'
                          : 'bg-neutral-950 text-white hover:bg-neutral-800'
                      }`}
                    >
                      Use for transfer
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSplitAssetId(asset.assetId)
                        setSelectedIssuedAssetId(asset.assetId)
                      }}
                      className={`rounded-full border px-4 py-2 text-sm font-medium ${
                        selected
                          ? 'border-white/20 bg-white/10 text-white hover:bg-white/15'
                          : 'border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100'
                      }`}
                    >
                      Use for split
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedIssuedAssetId(asset.assetId)}
                      className={`rounded-full border px-4 py-2 text-sm font-medium ${
                        selected
                          ? 'border-white/20 bg-white/10 text-white hover:bg-white/15'
                          : 'border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100'
                      }`}
                    >
                      Select for reissue
                    </button>
                    <button
                      type="button"
                      onClick={() => handleForgetAsset(asset.assetId)}
                      className={`rounded-full border px-4 py-2 text-sm font-medium ${
                        selected
                          ? 'border-white/20 bg-transparent text-white hover:bg-white/10'
                          : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
                      }`}
                    >
                      Forget
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </Section>

      <div className="grid gap-8 xl:grid-cols-2">
        <Section eyebrow="Transfer" title="Send an asset to an address">
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Destination address"
              helper="Defaults to the connected wallet receive address."
            >
              <Input
                value={transferDestinationAddress}
                onChange={(event) => setTransferDestinationAddress(event.target.value)}
                placeholder="tex1..."
              />
            </Field>
            <Field
              label="Amount (sats)"
              helper="Amount of the selected asset to send."
            >
              <Input
                value={transferAmountSat}
                onChange={(event) => setTransferAmountSat(event.target.value)}
                inputMode="numeric"
                placeholder="100"
              />
            </Field>
          </div>
          <Field
            label="Asset id"
            helper="Leave the policy asset id for LBTC, or paste an issued asset id."
          >
            <Input
              value={transferAssetId}
              onChange={(event) => setTransferAssetId(event.target.value)}
              placeholder={policyAssetId}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleTransfer}
              disabled={transferState.loading}
              className="rounded-full bg-neutral-950 px-5 py-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {transferState.loading ? 'Transferring…' : 'Transfer asset'}
            </button>
            {transferAssetId.trim() ? (
              <ExplorerLink
                href={esplora.getAssetExplorerUrl(transferAssetId.trim())}
                label="Open asset on explorer"
              />
            ) : null}
          </div>
          <ActionStatus state={transferState} esplora={esplora} />
        </Section>

        <Section eyebrow="Split" title="Create multiple equal outputs">
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Destination address"
              helper="All split outputs go to this script."
            >
              <Input
                value={splitDestinationAddress}
                onChange={(event) => setSplitDestinationAddress(event.target.value)}
                placeholder="tex1..."
              />
            </Field>
            <Field
              label="Asset id"
              helper="LBTC by default, or switch to a saved asset id."
            >
              <Input
                value={splitAssetId}
                onChange={(event) => setSplitAssetId(event.target.value)}
                placeholder={policyAssetId}
              />
            </Field>
            <Field
              label="Split parts"
              helper="How many equal outputs to create."
            >
              <Input
                value={splitParts}
                onChange={(event) => setSplitParts(event.target.value)}
                inputMode="numeric"
                placeholder="4"
              />
            </Field>
            <Field
              label="Part amount (sats)"
              helper="Amount per resulting output."
            >
              <Input
                value={splitPartAmountSat}
                onChange={(event) => setSplitPartAmountSat(event.target.value)}
                inputMode="numeric"
                placeholder="100"
              />
            </Field>
          </div>
          <button
            type="button"
            onClick={handleSplit}
            disabled={splitState.loading}
            className="rounded-full bg-neutral-950 px-5 py-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {splitState.loading ? 'Splitting…' : 'Split outputs'}
          </button>
          <ActionStatus state={splitState} esplora={esplora} />
        </Section>
      </div>

      <div className="grid gap-8 xl:grid-cols-2">
        <Section eyebrow="Issue" title="Issue a new demo asset">
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Asset label"
              helper="Stored locally for later reissuance. Blank uses an automatic demo label."
            >
              <Input
                value={issueLabel}
                onChange={(event) => setIssueLabel(event.target.value)}
                placeholder="Demo bond points"
              />
            </Field>
            <Field
              label="Issue amount (sats)"
              helper="Satoshi-style units for the new asset."
            >
              <Input
                value={issueAmountSat}
                onChange={(event) => setIssueAmountSat(event.target.value)}
                inputMode="numeric"
                placeholder="1000"
              />
            </Field>
          </div>
          <Field
            label="Destination address"
            helper="Receives both the new asset units and the reissuance token."
          >
            <Input
              value={issueDestinationAddress}
              onChange={(event) => setIssueDestinationAddress(event.target.value)}
              placeholder="tex1..."
            />
          </Field>
          <button
            type="button"
            onClick={handleIssue}
            disabled={issueState.loading}
            className="rounded-full bg-neutral-950 px-5 py-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {issueState.loading ? 'Issuing…' : 'Issue asset'}
          </button>
          <ActionStatus state={issueState} esplora={esplora}>
            {issueState.issuedAsset ? (
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-4 text-sm text-neutral-700">
                <p className="font-medium text-neutral-900">{issueState.issuedAsset.label}</p>
                <div className="mt-3 space-y-2">
                  <p>
                    Asset:{' '}
                    <ExplorerLink
                      href={esplora.getAssetExplorerUrl(issueState.issuedAsset.assetId)}
                      label={shortId(issueState.issuedAsset.assetId)}
                    />
                  </p>
                  <p>
                    Reissue token:{' '}
                    <ExplorerLink
                      href={esplora.getAssetExplorerUrl(issueState.issuedAsset.reissuanceTokenId)}
                      label={shortId(issueState.issuedAsset.reissuanceTokenId)}
                    />
                  </p>
                  <p className="break-all font-mono text-xs text-neutral-600">
                    Entropy: {issueState.issuedAsset.assetEntropy}
                  </p>
                </div>
              </div>
            ) : null}
          </ActionStatus>
        </Section>

        <Section eyebrow="Reissue" title="Reissue a saved demo asset">
          <Field
            label="Saved issued asset"
            helper="Select a previously issued demo asset from the browser registry."
          >
            <select
              value={selectedIssuedAssetId}
              onChange={(event) => setSelectedIssuedAssetId(event.target.value)}
              className={formClassNames.select}
              disabled={issuedAssets.length === 0}
            >
              {issuedAssets.length === 0 ? (
                <option value="">No issued assets saved yet</option>
              ) : (
                issuedAssets.map((asset) => (
                  <option key={asset.assetId} value={asset.assetId}>
                    {asset.label} ({shortId(asset.assetId)})
                  </option>
                ))
              )}
            </select>
          </Field>
          {selectedIssuedAsset ? (
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-4 text-sm text-neutral-700">
              <p className="font-medium text-neutral-900">{selectedIssuedAsset.label}</p>
              <div className="mt-3 space-y-2">
                <p>
                  Asset:{' '}
                  <ExplorerLink
                    href={esplora.getAssetExplorerUrl(selectedIssuedAsset.assetId)}
                    label={shortId(selectedIssuedAsset.assetId)}
                  />
                </p>
                <p>
                  Reissue token:{' '}
                  <ExplorerLink
                    href={esplora.getAssetExplorerUrl(selectedIssuedAsset.reissuanceTokenId)}
                    label={shortId(selectedIssuedAsset.reissuanceTokenId)}
                  />
                </p>
                <p className="break-all font-mono text-xs text-neutral-600">
                  Entropy: {selectedIssuedAsset.assetEntropy}
                </p>
              </div>
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-4 text-sm text-neutral-600">
              Issue an asset first, or keep a saved registry entry for the connected wallet and
              network.
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Destination address"
              helper="Receives the reissued asset output."
            >
              <Input
                value={reissueDestinationAddress}
                onChange={(event) => setReissueDestinationAddress(event.target.value)}
                placeholder="tex1..."
              />
            </Field>
            <Field
              label="Reissue amount (sats)"
              helper="Amount of the asset to create in this reissuance."
            >
              <Input
                value={reissueAmountSat}
                onChange={(event) => setReissueAmountSat(event.target.value)}
                inputMode="numeric"
                placeholder="1000"
              />
            </Field>
          </div>
          <button
            type="button"
            onClick={handleReissue}
            disabled={reissueState.loading || !selectedIssuedAsset}
            className="rounded-full bg-neutral-950 px-5 py-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {reissueState.loading ? 'Reissuing…' : 'Reissue asset'}
          </button>
          <ActionStatus state={reissueState} esplora={esplora} />
        </Section>
      </div>
    </div>
  )
}
