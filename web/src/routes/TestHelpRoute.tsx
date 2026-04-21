import { RouteScaffold } from './RouteScaffold'
import { SectionCard } from './RouteWidgets'

const COMMAND_ORDER = [
  'Connect the Blockstream wallet.',
  'Call `get_signer_receive_address` and `get_raw_signing_x_only_pubkey` to verify identity.',
  'Prepare the auxiliary issuance asset used for utility NFT creation.',
  'Issue borrower, lender, and parameter NFTs.',
  'Create the pre-lock transaction from those issued assets.',
  'Accept the offer into a lending contract, or cancel before acceptance.',
  'Repay and claim after repayment, or liquidate after expiry.',
]

export function TestHelpRoute() {
  return (
    <RouteScaffold
      eyebrow="Testing Guide"
      title="Wallet ABI test route checklist."
      description="Use the dedicated testing route to inspect requests before they reach the wallet, replay raw envelopes, and verify protocol ordering with the Blockstream app on Liquid testnet."
    >
      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <SectionCard title="Order Of Commands">
          <ol className="mt-5 space-y-3 text-sm leading-7 text-stone-700">
            {COMMAND_ORDER.map((item, index) => (
              <li key={item} className="flex gap-3">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-xs font-semibold text-white">
                  {index + 1}
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </SectionCard>

        <SectionCard title="Method Notes">
          <div className="mt-5 space-y-4 text-sm leading-7 text-stone-700">
            <p>
              <code className="font-mono text-[#5F3DC4]">
                get_signer_receive_address
              </code>{' '}
              returns the wallet-controlled Liquid receive address used for explorer and balance
              lookups.
            </p>
            <p>
              <code className="font-mono text-[#5F3DC4]">
                get_raw_signing_x_only_pubkey
              </code>{' '}
              returns the borrower identity key used by the lending indexer.
            </p>
            <p>
              <code className="font-mono text-[#5F3DC4]">
                wallet_abi_process_request
              </code>{' '}
              is the transaction method used by every utility, borrower, and lender flow.
            </p>
          </div>
        </SectionCard>
      </div>
    </RouteScaffold>
  )
}
