import { useCallback, useRef, useState } from 'react'
import {
  WalletAbiStatus,
  walletAbiJsonString,
  type WalletAbiTxCreateRequest,
  type WalletAbiTxCreateResponse,
} from 'lwk_wallet_abi_sdk'
import { useWalletAbiSession } from './session'
import { formatJson } from './format'

export interface WalletAbiActionState {
  status: 'idle' | 'running' | 'success' | 'error'
  label: string | null
  requestJson: string | null
  responseJson: string | null
  txId: string | null
  txHex: string | null
  error: string | null
}

const DEFAULT_STATE: WalletAbiActionState = {
  status: 'idle',
  label: null,
  requestJson: null,
  responseJson: null,
  txId: null,
  txHex: null,
  error: null,
}

function traceStage(stage: string) {
  const target = globalThis as typeof globalThis & {
    __walletAbiStages?: string[]
  }
  target.__walletAbiStages ??= []
  target.__walletAbiStages.push(stage)
  console.log(stage)
}

export interface WalletAbiBuiltRequest<TMeta = unknown> {
  request: WalletAbiTxCreateRequest
  meta?: TMeta
}

function isDroppedSessionRequest(error: unknown): boolean {
  return error instanceof Error && error.message.includes('wallet session disconnected')
}

function extractTxInfo(response: WalletAbiTxCreateResponse) {
  if (response.status() !== WalletAbiStatus.Ok) {
    return { txId: null, txHex: null }
  }

  const transaction = response.transaction()
  if (!transaction) {
    return { txId: null, txHex: null }
  }

  return {
    txId: transaction.txid().toString(),
    txHex: transaction.txHex(),
  }
}

export function useWalletAbiActionRunner() {
  const session = useWalletAbiSession()
  const [action, setAction] = useState<WalletAbiActionState>(DEFAULT_STATE)
  const runGenerationRef = useRef(0)
  const inFlightRef = useRef(false)
  const sessionInactive = session.status === 'disconnecting' || session.status === 'disconnected'

  const reset = useCallback(() => {
    runGenerationRef.current += 1
    inFlightRef.current = false
    setAction(DEFAULT_STATE)
  }, [])

  const run = useCallback(
    async <TMeta,>(
      label: string,
      build: () => Promise<WalletAbiBuiltRequest<TMeta>>,
      onSuccess?: (result: {
        meta: TMeta | undefined
        response: WalletAbiTxCreateResponse
        txId: string | null
        txHex: string | null
      }) => Promise<void> | void
    ) => {
      if (inFlightRef.current) {
        traceStage(`[wallet-abi] ${label}:ignored request already running`)
        return
      }

      inFlightRef.current = true
      const runGeneration = ++runGenerationRef.current

      const setActionIfCurrent = (nextAction: WalletAbiActionState) => {
        if (runGeneration === runGenerationRef.current) {
          setAction(nextAction)
        }
      }

      setActionIfCurrent({
        status: 'running',
        label,
        requestJson: null,
        responseJson: null,
        txId: null,
        txHex: null,
        error: null,
      })

      try {
        traceStage(`[wallet-abi] ${label}:build:start`)
        const built = await build()
        traceStage(`[wallet-abi] ${label}:build:done`)
        traceStage(`[wallet-abi] ${label}:request-json:start`)
        const requestJson = formatJson(walletAbiJsonString(built.request))
        traceStage(`[wallet-abi] ${label}:request-json:done`)
        traceStage(`[wallet-abi] ${label}:process:start`)
        const { value } = await session.processRequest(built.request)
        traceStage(`[wallet-abi] ${label}:process:done`)
        const responseJson = formatJson(value.toJSON())
        const { txId, txHex } = extractTxInfo(value)

        setActionIfCurrent({
          status: value.status() === WalletAbiStatus.Ok ? 'success' : 'error',
          label,
          requestJson,
          responseJson,
          txId,
          txHex,
          error: value.errorInfo()?.message() ?? null,
        })

        if (runGeneration !== runGenerationRef.current) {
          return
        }

        traceStage(`[wallet-abi] ${label}:success status=${value.status()}`)
        await onSuccess?.({
          meta: built.meta,
          response: value,
          txId,
          txHex,
        })
      } catch (error) {
        traceStage(`[wallet-abi] ${label}:error`)
        console.error(`[wallet-abi] ${label}:error`, error)
        if (isDroppedSessionRequest(error)) {
          setActionIfCurrent(DEFAULT_STATE)
          return
        }
        setActionIfCurrent({
          status: 'error',
          label,
          requestJson: null,
          responseJson: null,
          txId: null,
          txHex: null,
          error: error instanceof Error ? error.message : String(error),
        })
      } finally {
        inFlightRef.current = false
      }
    },
    [session]
  )

  return {
    action: sessionInactive ? DEFAULT_STATE : action,
    reset,
    run,
  }
}
