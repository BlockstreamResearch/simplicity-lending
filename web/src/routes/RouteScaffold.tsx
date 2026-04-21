export function RouteScaffold({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-8">
      <div className="rounded-[2rem] border border-neutral-200 bg-[linear-gradient(135deg,#f4efe6_0%,#ffffff_55%,#f6faf8_100%)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.07)] sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-neutral-500">
          {eyebrow}
        </p>
        <h2 className="mt-3 max-w-4xl text-2xl font-semibold tracking-tight text-neutral-950 sm:text-4xl">
          {title}
        </h2>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-neutral-600 sm:text-base sm:leading-7">
          {description}
        </p>
      </div>

      {children}
    </section>
  )
}

export function EmptyRouteNotice({
  title,
  body,
}: {
  title: string
  body: string
}) {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-neutral-300 bg-neutral-50 p-5 text-neutral-700">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-500">{title}</p>
      <p className="mt-3 max-w-2xl text-sm leading-7">{body}</p>
    </div>
  )
}
