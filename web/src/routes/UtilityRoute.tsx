import { useMemo, useState } from 'react'
import { RouteScaffold } from './RouteScaffold'
import {
  ActionStateCard,
  ConnectionGate,
  FieldInput,
  FieldLabel,
  FieldTextarea,
  PrimaryButton,
  SecondaryButton,
  SectionCard,
} from './RouteWidgets'
import { useWalletAbiSession } from '../walletAbi/session'
import { useWalletAddressData } from '../hooks/useWalletAddressData'
import { useBorrowerFlowState } from '../walletAbi/useBorrowerFlowState'
import { useWalletAbiActionRunner } from '../walletAbi/actionRunner'
import {
  createIssueUtilityNftsRequest,
  createPrepareUtilityRequest,
  createUtilityBurnRequest,
  createUtilityTransferRequest,
} from '../walletAbi/requests'
import { parseExplicitOutputsFromTxHex } from '../walletAbi/transactions'

type UtilityMode = 'split-native' | 'split-asset' | 'merge-native' | 'merge-asset'

function parseRecipientLines(value: string) {
  const recipients = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [address, amount] = line.split(',').map((part) => part.trim())
      if (!address || !amount) {
        throw new Error(`Recipient line ${index + 1} must be "address, amount".`)
      }
      const amountSat = BigInt(amount)
      if (amountSat <= 0n) {
        throw new Error(`Recipient line ${index + 1} must use a positive amount.`)
      }
      return {
        id: `recipient-${index}`,
        address,
        amountSat,
      }
    })

  if (recipients.length === 0) {
    throw new Error('Enter at least one recipient.')
  }

  return recipients
}

function StoredStateCard({
  address,
  state,
  onClear,
}: {
  address: string | null
  state: ReturnType<typeof useBorrowerFlowState>['state']
  onClear: () => void
}) {
  return (
    <SectionCard
      title="Stored Borrower Setup"
      description="Saved per wallet for Borrower reuse."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <dl className="space-y-3 text-sm text-stone-700">
          <div>
            <dt className="font-semibold text-stone-500">Wallet</dt>
            <dd className="mt-1 break-all font-mono text-stone-950">{address ?? 'Not connected'}</dd>
          </div>
          <div>
            <dt className="font-semibold text-stone-500">Prepare Txid</dt>
            <dd className="mt-1 break-all font-mono text-stone-950">{state.prepareTxId ?? 'None'}</dd>
          </div>
          <div>
            <dt className="font-semibold text-stone-500">Auxiliary Asset</dt>
            <dd className="mt-1 break-all font-mono text-stone-950">
              {state.auxiliaryAssetId ?? 'None'}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-stone-500">Issuance Entropy</dt>
            <dd className="mt-1 break-all font-mono text-stone-950">
              {state.issuanceEntropyHex ?? 'None'}
            </dd>
          </div>
        </dl>

        <dl className="space-y-3 text-sm text-stone-700">
          <div>
            <dt className="font-semibold text-stone-500">Issue Txid</dt>
            <dd className="mt-1 break-all font-mono text-stone-950">{state.issuanceTxId ?? 'None'}</dd>
          </div>
          <div>
            <dt className="font-semibold text-stone-500">Parameter NFTs</dt>
            <dd className="mt-1 break-all font-mono text-stone-950">
              {state.firstParametersNftAssetId ?? 'None'}
            </dd>
            <dd className="mt-1 break-all font-mono text-stone-950">
              {state.secondParametersNftAssetId ?? 'None'}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-stone-500">Participant NFTs</dt>
            <dd className="mt-1 break-all font-mono text-stone-950">
              {state.borrowerNftAssetId ?? 'None'}
            </dd>
            <dd className="mt-1 break-all font-mono text-stone-950">
              {state.lenderNftAssetId ?? 'None'}
            </dd>
          </div>
          <div className="pt-2">
            <SecondaryButton onClick={onClear}>Clear Stored State</SecondaryButton>
          </div>
        </dl>
      </div>
    </SectionCard>
  )
}

export function UtilityRoute() {
  const session = useWalletAbiSession()
  const walletData = useWalletAddressData(session.receiveAddress)
  const borrowerState = useBorrowerFlowState(session.receiveAddress)
  const requestAction = useWalletAbiActionRunner()
  const connected = session.status === 'connected' && Boolean(session.receiveAddress)

  const [mode, setMode] = useState<UtilityMode>('split-native')
  const [recipientLines, setRecipientLines] = useState('')
  const [transferAssetId, setTransferAssetId] = useState('')
  const [burnAssetId, setBurnAssetId] = useState('')
  const [burnAmount, setBurnAmount] = useState('')
  const [collateralAmount, setCollateralAmount] = useState(
    borrowerState.state.collateralAmount ?? ''
  )
  const [principalAmount, setPrincipalAmount] = useState(
    borrowerState.state.principalAmount ?? ''
  )
  const [loanExpirationTime, setLoanExpirationTime] = useState(
    borrowerState.state.loanExpirationTime != null
      ? String(borrowerState.state.loanExpirationTime)
      : ''
  )
  const [interestPercent, setInterestPercent] = useState(
    borrowerState.state.interestRateBasisPoints != null
      ? (borrowerState.state.interestRateBasisPoints / 100).toFixed(2)
      : ''
  )

  const defaultRecipientLines = useMemo(() => {
    if (!session.receiveAddress) {
      return 'ex1qq..., 1000'
    }
    return `${session.receiveAddress}, 1000`
  }, [session.receiveAddress])

  return (
    <RouteScaffold
      eyebrow="Utility"
      title="Transfers, burns, and setup."
      description="Build Wallet ABI requests for utility flows and borrower setup."
    >
      <div className="grid gap-10 xl:grid-cols-[minmax(0,1.55fr)_20rem]">
        <div className="space-y-5">
          <SectionCard
            title="Wallet View"
            description="Current address and UTXOs."
          >
            <dl className="grid gap-4 text-sm text-stone-700 md:grid-cols-2">
              <div>
                <dt className="font-semibold text-stone-500">Connection</dt>
                <dd className="mt-1 font-mono text-stone-950">{session.status}</dd>
              </div>
              <div>
                <dt className="font-semibold text-stone-500">Address UTXOs</dt>
                <dd className="mt-1 font-mono text-stone-950">{walletData.utxos.length}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="font-semibold text-stone-500">Receive Address</dt>
                <dd className="mt-1 break-all font-mono text-stone-950">
                  {session.receiveAddress ?? 'Connect the wallet first.'}
                </dd>
              </div>
              {walletData.error ? (
                <div className="md:col-span-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
                  {walletData.error}
                </div>
              ) : null}
            </dl>
          </SectionCard>

          <StoredStateCard
            address={session.receiveAddress}
            state={borrowerState.state}
            onClear={borrowerState.clear}
          />

          <SectionCard
            title="Transfer Requests"
            description="Use one or many explicit recipients."
          >
            <ConnectionGate connected={connected}>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <FieldLabel>Mode</FieldLabel>
                  <select
                    value={mode}
                    onChange={(event) => setMode(event.target.value as UtilityMode)}
                    className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-[#5F3DC4] focus:ring-2 focus:ring-[#5F3DC4]/20"
                  >
                    <option value="split-native">Split Native</option>
                    <option value="split-asset">Split Asset</option>
                    <option value="merge-native">Merge Native</option>
                    <option value="merge-asset">Merge Asset</option>
                  </select>
                </div>
                {mode.includes('asset') ? (
                  <div>
                    <FieldLabel>Asset Id</FieldLabel>
                    <FieldInput
                      value={transferAssetId}
                      onChange={(event) => setTransferAssetId(event.target.value)}
                      placeholder="64-char asset id"
                    />
                  </div>
                ) : null}
                <div className="md:col-span-2">
                  <FieldLabel>Recipients</FieldLabel>
                  <FieldTextarea
                    value={recipientLines}
                    onChange={(event) => setRecipientLines(event.target.value)}
                    placeholder={defaultRecipientLines}
                  />
                  <p className="mt-2 text-xs text-stone-500">
                    One recipient per line in the form <code>address, amount</code>.
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <PrimaryButton
                  disabled={requestAction.action.status === 'running'}
                  onClick={() =>
                    requestAction.run('utility transfer', () =>
                      createUtilityTransferRequest({
                        recipients: parseRecipientLines(recipientLines),
                        assetIdHex: mode.includes('asset') ? transferAssetId : null,
                      })
                    )
                  }
                >
                  Submit Transfer
                </PrimaryButton>
                <SecondaryButton onClick={() => setRecipientLines(defaultRecipientLines)}>
                  Use Wallet Address
                </SecondaryButton>
              </div>
            </ConnectionGate>
          </SectionCard>

          <SectionCard
            title="Burn Asset"
            description="Burn an asset amount from the connected wallet."
          >
            <ConnectionGate connected={connected}>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <FieldLabel>Asset Id</FieldLabel>
                  <FieldInput
                    value={burnAssetId}
                    onChange={(event) => setBurnAssetId(event.target.value)}
                    placeholder="64-char asset id"
                  />
                </div>
                <div>
                  <FieldLabel>Amount (sat)</FieldLabel>
                  <FieldInput
                    value={burnAmount}
                    onChange={(event) => setBurnAmount(event.target.value)}
                    placeholder="1000"
                  />
                </div>
              </div>

              <div className="mt-5">
                <PrimaryButton
                  disabled={requestAction.action.status === 'running'}
                  onClick={() =>
                    requestAction.run('utility burn', async () => ({
                      request: (
                        await createUtilityBurnRequest({
                          assetIdHex: burnAssetId,
                          amountSat: BigInt(burnAmount),
                        })
                      ).request,
                    }))
                  }
                >
                  Submit Burn
                </PrimaryButton>
              </div>
            </ConnectionGate>
          </SectionCard>

          <SectionCard
            title="Prepare Auxiliary Asset"
            description="Create the stored preparation outputs for borrower setup."
          >
            <ConnectionGate connected={connected}>
              <PrimaryButton
                disabled={requestAction.action.status === 'running' || !session.receiveAddress}
                onClick={() =>
                  requestAction.run(
                    'prepare utility asset',
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
                    }
                  )
                }
              >
                Prepare Utility UTXOs
              </PrimaryButton>
            </ConnectionGate>
          </SectionCard>

          <SectionCard
            title="Issue Utility NFTs"
            description="Issue the borrower, lender, and parameter NFTs."
          >
            <ConnectionGate connected={connected}>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <FieldLabel>Collateral Amount (sat)</FieldLabel>
                  <FieldInput
                    value={collateralAmount}
                    onChange={(event) => setCollateralAmount(event.target.value)}
                    placeholder="1000"
                  />
                </div>
                <div>
                  <FieldLabel>Principal Amount (sat)</FieldLabel>
                  <FieldInput
                    value={principalAmount}
                    onChange={(event) => setPrincipalAmount(event.target.value)}
                    placeholder="5000"
                  />
                </div>
                <div>
                  <FieldLabel>Loan Expiration Height</FieldLabel>
                  <FieldInput
                    value={loanExpirationTime}
                    onChange={(event) => setLoanExpirationTime(event.target.value)}
                    placeholder="height"
                  />
                </div>
                <div>
                  <FieldLabel>Interest Percent</FieldLabel>
                  <FieldInput
                    value={interestPercent}
                    onChange={(event) => setInterestPercent(event.target.value)}
                    placeholder="2.00"
                  />
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <PrimaryButton
                  disabled={
                    requestAction.action.status === 'running' ||
                    !session.receiveAddress ||
                    !borrowerState.state.prepareTxId ||
                    !borrowerState.state.auxiliaryAssetId ||
                    !borrowerState.state.issuanceEntropyHex
                  }
                  onClick={() =>
                    requestAction.run(
                      'issue utility NFTs',
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
                      }
                    )
                  }
                >
                  Issue Utility NFTs
                </PrimaryButton>
              </div>
            </ConnectionGate>
          </SectionCard>
        </div>

        <ActionStateCard action={requestAction.action} />
      </div>
    </RouteScaffold>
  )
}
