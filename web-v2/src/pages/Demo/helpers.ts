import type { AssetId, WalletTxOut } from 'lwk_web'
import { useEffect, useState } from 'react'

import { fetchTxConfirmations } from '@/api/esplora/methods'
import type { ConfirmedTx } from '@/hooks/useTxConfirmations'
import { isPolicyAssetUtxo, utxoToOutpointString } from '@/lwk/utxo'

export interface DemoScriptAuthInputSelection {
  authUtxo: WalletTxOut
  fundingUtxo: WalletTxOut
}

/**
 * Temporary input selection strategy used by
 * ScriptAuth smoke tests and demo flows.
 *
 * Production covenant creation will use
 * explicit auth/funding UTXO selection.
 */
export function selectDemoScriptAuthInputs(
  walletUtxos: WalletTxOut[],
  policyAsset: AssetId | string,
  feeReserve: bigint,
): DemoScriptAuthInputSelection {
  const lbtcUtxos = walletUtxos.filter(utxo => isPolicyAssetUtxo(utxo, policyAsset))

  const fundingUtxo = lbtcUtxos
    .filter(utxo => utxo.unblinded().value() > feeReserve)
    .sort((a, b) => {
      const aValue = a.unblinded().value()
      const bValue = b.unblinded().value()
      if (aValue === bValue) return 0
      return bValue > aValue ? 1 : -1
    })[0]

  if (!fundingUtxo) {
    throw new Error('Need a wallet L-BTC UTXO larger than the fee reserve to fund ScriptAuth')
  }

  const fundingOutpoint = utxoToOutpointString(fundingUtxo)
  const authUtxo = lbtcUtxos.find(utxo => utxoToOutpointString(utxo) !== fundingOutpoint)

  if (!authUtxo) {
    throw new Error('Need a second wallet L-BTC UTXO to use as the ScriptAuth auth input')
  }

  return { authUtxo, fundingUtxo }
}

export interface SavedScriptAuthState {
  authOutpoint: string
  scriptHashHex: string
  fundingTxid: string
}

export function latestScriptAuthState() {
  const states = getScriptAuthStates()
  return states[states.length - 1] ?? null
}

export function useTxConfirmations(txid: string | null): number | null {
  const [confirmedTx, setConfirmedTx] = useState<ConfirmedTx | null>(null)

  useEffect(() => {
    if (!txid) {
      return
    }

    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    const poll = async () => {
      try {
        const nextConfirmations = await fetchTxConfirmations(txid)

        if (cancelled) {
          return
        }

        if (nextConfirmations !== null && nextConfirmations >= 1) {
          setConfirmedTx({ txid, phase: 'confirmed', confirmations: nextConfirmations })
          if (intervalId) {
            clearInterval(intervalId)
          }
        }
      } catch (err) {
        console.warn(err)
      }
    }

    poll()
    intervalId = setInterval(() => {
      poll()
    }, 15_000)

    return () => {
      cancelled = true
      if (intervalId) {
        clearInterval(intervalId)
      }
    }
  }, [txid])

  return confirmedTx?.txid === txid ? confirmedTx.confirmations : null
}

const SCRIPT_AUTH_STORAGE_KEY = 'script-auth-covenants'

export function getScriptAuthStates(): SavedScriptAuthState[] {
  const raw = localStorage.getItem(SCRIPT_AUTH_STORAGE_KEY)

  if (!raw) {
    return []
  }

  return JSON.parse(raw)
}

export function saveScriptAuthState(state: SavedScriptAuthState): void {
  const existingStates = getScriptAuthStates()

  existingStates.push(state)

  localStorage.setItem(SCRIPT_AUTH_STORAGE_KEY, JSON.stringify(existingStates))
}

export function removeScriptAuthState(authOutpoint: string): void {
  const existingStates = getScriptAuthStates()

  const filteredStates = existingStates.filter(state => state.authOutpoint !== authOutpoint)

  localStorage.setItem(SCRIPT_AUTH_STORAGE_KEY, JSON.stringify(filteredStates))
}

export function formatCollateralUtxoOption(utxo: WalletTxOut): { id: string; label: string } {
  const outpoint = utxoToOutpointString(utxo)
  const height = utxo.height()
  const status = height === undefined ? 'mempool' : `height ${height}`
  return {
    id: outpoint,
    label: `${outpoint} | ${utxo.unblinded().value().toString()} sats | ${status}`,
  }
}
