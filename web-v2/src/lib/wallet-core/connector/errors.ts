export class JadeBusyError extends Error {
  constructor() {
    super('Jade is busy signing — try again once the current operation finishes')
    this.name = 'JadeBusyError'
  }
}

export class JadeNotConnectedError extends Error {
  constructor() {
    super('Jade is not connected')
    this.name = 'JadeNotConnectedError'
  }
}

export class JadeUnlockFailedError extends Error {
  constructor() {
    super('Failed to unlock Jade. Check the device and PIN, then try again')
    this.name = 'JadeUnlockFailedError'
  }
}

export class JadeSignDeclinedError extends Error {
  constructor() {
    super('Signing was declined on the Jade device')
    this.name = 'JadeSignDeclinedError'
  }
}

export class JadeDisconnectedError extends Error {
  constructor() {
    super('Jade device disconnected')
    this.name = 'JadeDisconnectedError'
  }
}

export class JadeNetworkMismatchError extends Error {
  constructor() {
    super(
      'Jade is unlocked for a different network. Connect with the matching network, or reset the device to switch',
    )
    this.name = 'JadeNetworkMismatchError'
  }
}

export class JadeConnectionLockedError extends Error {
  constructor() {
    super('Jade is already connected elsewhere — close other tabs, windows, or apps using it')
    this.name = 'JadeConnectionLockedError'
  }
}

export class JadePortNotSelectedError extends Error {
  constructor() {
    super('No Jade device was selected')
    this.name = 'JadePortNotSelectedError'
  }
}

export class JadePermissionDeniedError extends Error {
  constructor() {
    super('Permission to access the Jade device was denied')
    this.name = 'JadePermissionDeniedError'
  }
}

export class JadeOpenFailedError extends Error {
  constructor(cause?: unknown) {
    super('Failed to open a connection to the Jade device', { cause })
    this.name = 'JadeOpenFailedError'
  }
}

export function toJadeConnectError(error: unknown): Error {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'InvalidStateError':
      case 'NetworkError':
        return new JadeConnectionLockedError()
      case 'NotFoundError':
        return new JadePortNotSelectedError()
      case 'SecurityError':
        return new JadePermissionDeniedError()
    }
  }
  return error instanceof Error ? error : new JadeOpenFailedError(error)
}

export function mapJadeRpcError(error: unknown): Error {
  if (error instanceof Error) {
    if (error.message === 'Wrong Pin') return new JadeUnlockFailedError()
    if (error.message === 'Jade not initialized') return new JadeNotConnectedError()
    if (error.message.includes('User declined to sign')) return new JadeSignDeclinedError()
    if (error.message.includes('Network type inconsistent with prior usage'))
      return new JadeNetworkMismatchError()

    // `JsValue(...)` means the Jade serial connection was lost.
    if (error.message.startsWith('JsValue(')) return new JadeDisconnectedError()
  }
  return error instanceof Error ? error : new Error(String(error))
}

export class SeedNotConnectedError extends Error {
  constructor() {
    super('Seed signer is not connected')
    this.name = 'SeedNotConnectedError'
  }
}

export class SeedMissingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SeedMissingError'
  }
}
