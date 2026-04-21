import type { WalletAbiActionState } from '../walletAbi/actionRunner'

export function SectionCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <article className="rounded-[2rem] border border-neutral-200 bg-white p-6 shadow-[0_18px_50px_rgba(0,0,0,0.06)]">
      <div className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-500">
          {title}
        </p>
        {description ? (
          <p className="mt-3 text-sm leading-6 text-neutral-600">{description}</p>
        ) : null}
      </div>
      <div className="mt-5">{children}</div>
    </article>
  )
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-xs font-medium uppercase tracking-wide text-gray-500">
      {children}
    </label>
  )
}

export function FieldInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`mt-2 w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-[#5F3DC4] focus:ring-2 focus:ring-[#5F3DC4]/20 ${props.className ?? ''}`.trim()}
    />
  )
}

export function FieldTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`mt-2 min-h-28 w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-[#5F3DC4] focus:ring-2 focus:ring-[#5F3DC4]/20 ${props.className ?? ''}`.trim()}
    />
  )
}

export function PrimaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded-full bg-neutral-950 px-5 py-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 ${props.className ?? ''}`.trim()}
    >
      {children}
    </button>
  )
}

export function SecondaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded-full border border-neutral-300 bg-white px-5 py-3 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 ${props.className ?? ''}`.trim()}
    >
      {children}
    </button>
  )
}

export function ConnectionGate({
  connected,
  children,
}: {
  connected: boolean
  children: React.ReactNode
}) {
  if (connected) {
    return <>{children}</>
  }

  return (
    <div className="rounded-[1.5rem] border border-dashed border-neutral-300 bg-neutral-50 p-5 text-sm leading-6 text-neutral-600">
      Connect the wallet to send requests from this page.
    </div>
  )
}

export function ActionStateCard({
  action,
}: {
  action: WalletAbiActionState
}) {
  return (
    <article className="rounded-[2rem] border border-neutral-200 bg-white p-6 shadow-[0_18px_50px_rgba(0,0,0,0.06)] lg:sticky lg:top-28">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-500">
        Last Request
      </p>
      <div className="mt-4 space-y-4 text-sm leading-7">
        <p>
          <span className="text-neutral-500">Status:</span>{' '}
          <span className="font-semibold text-neutral-900">{action.status}</span>
          {action.label ? <span className="ml-2 text-neutral-500">({action.label})</span> : null}
        </p>
        {action.txId ? (
          <p className="break-all font-mono text-neutral-800">
            <span className="font-sans text-neutral-500">Txid:</span> {action.txId}
          </p>
        ) : null}
        {action.error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
            {action.error}
          </div>
        ) : null}
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Request JSON
          </p>
          <pre className="overflow-x-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs leading-6 text-gray-800">
            {action.requestJson ?? 'No request submitted yet.'}
          </pre>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Response JSON
          </p>
          <pre className="overflow-x-auto rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs leading-6 text-gray-800">
            {action.responseJson ?? 'No response received yet.'}
          </pre>
        </div>
      </div>
    </article>
  )
}
