import { useState } from 'react'

function shallowEqual<T extends object>(a: T, b: T): boolean {
  return (Object.keys(a) as (keyof T)[]).every(key => a[key] === b[key])
}

// Closing a modal usually resets its view (status -> 'idle') synchronously, in the same tick as
// the close click — while the modal is still playing its exit animation. Without freezing, the
// title/body would flicker from the success screen to the idle form right as it closes. Mirror
// `liveView` while open; once closed, keep returning whatever was last shown.
export function useFreezeViewWhileOpen<T extends object>(isOpen: boolean, liveView: T): T {
  const [frozenView, setFrozenView] = useState(liveView)
  if (isOpen && !shallowEqual(frozenView, liveView)) {
    setFrozenView(liveView)
  }
  return isOpen ? liveView : frozenView
}
