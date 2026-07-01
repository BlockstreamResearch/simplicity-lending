// Generic preserves literal step IDs for type-safe `advance()`
export interface TransactionStep<Id extends string = string> {
  id: Id
  title: string
  subtitle: string
}

export type TransactionSteps = readonly TransactionStep[]
export type AdvanceTxProgress<Steps extends TransactionSteps> = (
  stepId: Steps[number]['id'],
) => Promise<void>
export type StartTxProgress = <const Steps extends TransactionSteps>(
  steps: Steps,
) => AdvanceTxProgress<Steps>

export interface TxProgressContextValue {
  steps: TransactionSteps
  currentStepId: string | null
  errorMessage: string | null
  startTxProgress: StartTxProgress
  setTxProgressError: (error: unknown) => void
}
