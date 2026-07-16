export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export type Deferred<T> = ReturnType<typeof Promise.withResolvers<T>>

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => Error,
): Promise<T> {
  return new Promise((resolve, reject) => {
    AbortSignal.timeout(ms).addEventListener('abort', () => reject(onTimeout()), { once: true })
    promise.then(resolve, reject)
  })
}
