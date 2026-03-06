/**
 * Standardized Build / Sign / Broadcast action buttons.
 * Use TxStatusBlock below for unsigned/signed hex and errors.
 */

import { ButtonPrimary, ButtonSecondary, ButtonNeutral } from './Button'

export interface TxActionButtonsProps {
  building: boolean
  hasBuiltTx: boolean
  hasSignedTx: boolean
  onBuild: () => void
  onSign: () => void
  onSignAndBroadcast: () => void
  broadcastButtonLabel: string
  canBuild?: boolean
  showClear?: boolean
  onClear?: () => void
  /**
   * When true, third button is enabled when hasBuiltTx (does sign+broadcast in one).
   * When false, third button is enabled when hasSignedTx (broadcast only). Default false.
   */
  thirdButtonRequiresOnlyBuilt?: boolean
  /** Which action is in progress; if not set, all buttons show "Working…" when building. */
  buildingPhase?: 'build' | 'sign' | 'broadcast' | null
}

export function TxActionButtons({
  building,
  hasBuiltTx,
  hasSignedTx,
  onBuild,
  onSign,
  onSignAndBroadcast,
  broadcastButtonLabel,
  canBuild = true,
  showClear = false,
  onClear,
  thirdButtonRequiresOnlyBuilt = false,
  buildingPhase = null,
}: TxActionButtonsProps) {
  const buildLabel =
    building && (buildingPhase === 'build' || !buildingPhase) ? 'Building…' : 'Build'
  const signLabel = building && (buildingPhase === 'sign' || !buildingPhase) ? 'Signing…' : 'Sign'
  const broadcastLabel =
    building && (buildingPhase === 'broadcast' || !buildingPhase)
      ? 'Sending…'
      : broadcastButtonLabel

  const thirdEnabled = thirdButtonRequiresOnlyBuilt ? hasBuiltTx : hasSignedTx

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <ButtonSecondary size="md" disabled={!canBuild || building} onClick={onBuild}>
        {buildLabel}
      </ButtonSecondary>
      <ButtonSecondary size="md" disabled={!hasBuiltTx || building} onClick={onSign}>
        {signLabel}
      </ButtonSecondary>
      <ButtonPrimary size="md" disabled={!thirdEnabled || building} onClick={onSignAndBroadcast}>
        {broadcastLabel}
      </ButtonPrimary>
      {showClear && onClear && (
        <ButtonNeutral size="md" disabled={building} onClick={onClear}>
          Clear
        </ButtonNeutral>
      )}
    </div>
  )
}
