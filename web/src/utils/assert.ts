export function softAssertNever(value: never): void {
  console.warn(`Unhandled case: ${JSON.stringify(value)}`)
}
