import { useWalletAbiSession } from './WalletAbiSessionContext'

export function WalletConnectCard() {
  const { connect, reconnect, disconnect, status, error, network } = useWalletAbiSession()
  const busy = status === 'connecting'

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-16 lg:flex-row lg:items-stretch">
      <div className="flex-1 rounded-[2rem] border border-neutral-200 bg-white p-10 shadow-[0_24px_80px_rgba(0,0,0,0.08)]">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-neutral-500">
          WalletConnect
        </p>
        <h1 className="mt-4 max-w-xl text-4xl font-semibold tracking-tight text-neutral-950">
          Connect the lending app to your wallet and approve requests on the phone.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-neutral-600">
          The browser never holds a seed. It uses WalletConnect for the Wallet ABI session and only
          shows state that is already public on chain or available through the indexer.
        </p>
        <div className="mt-8 flex flex-wrap gap-4">
          <button
            type="button"
            onClick={() => void (error ? reconnect() : connect())}
            disabled={busy}
            className="rounded-full bg-neutral-950 px-6 py-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
          >
            {busy ? 'Connecting wallet…' : error ? 'Reconnect wallet' : 'Connect wallet'}
          </button>
          <button
            type="button"
            onClick={() => void disconnect()}
            className="rounded-full border border-neutral-300 bg-white px-6 py-3 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
          >
            Drop saved connection
          </button>
          <div className="rounded-full border border-neutral-200 px-4 py-3 text-sm text-neutral-600">
            {busy
              ? 'Restoring the session or waiting for wallet approval'
              : `Wallet ABI network: ${network ?? 'not connected'}`}
          </div>
        </div>
        {error && (
          <p className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>

      <div className="w-full max-w-md rounded-[2rem] border border-neutral-200 bg-[linear-gradient(180deg,#faf7f2_0%,#ffffff_100%)] p-8 shadow-[0_24px_80px_rgba(0,0,0,0.08)]">
        <div className="rounded-[1.5rem] border border-neutral-200 bg-white p-6">
          <div className="flex aspect-square flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 px-8 text-center">
            <p className="text-sm font-medium text-neutral-800">Official WalletConnect modal</p>
            <p className="mt-3 text-sm leading-6 text-neutral-500">
              Reown AppKit opens the pairing flow when you connect. No custom QR renderer or custom
              pairing state is used anymore.
            </p>
          </div>
          <p className="mt-4 text-center text-sm text-neutral-500">
            Existing WalletConnect sessions restore automatically. Starting a new connection
            replaces stale Wallet ABI sessions for this app.
          </p>
        </div>
      </div>
    </section>
  )
}
