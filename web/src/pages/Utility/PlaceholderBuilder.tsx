/**
 * Placeholder for builders not yet implemented (Split asset, Merge).
 */

export interface PlaceholderBuilderProps {
  title: string
  description: string
}

export function PlaceholderBuilder({ title, description }: PlaceholderBuilderProps) {
  return (
    <section className="min-w-0 max-w-4xl mt-6 p-6 rounded-lg border border-amber-200 bg-amber-50">
      <h3 className="text-lg font-semibold text-amber-900">{title}</h3>
      <p className="text-amber-800 mt-2">{description}</p>
    </section>
  )
}
