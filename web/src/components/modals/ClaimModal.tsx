import { Chip } from '@heroui/react'
import { useMutation } from '@tanstack/react-query'
import { useMemo } from 'react'

import { fetchFeeRateSatPerKvb } from '@/api/esplora/fee'
import { broadcastTx } from '@/api/esplora/methods'
import { fetchOffer } from '@/api/indexer/methods'
import type { OfferShort } from '@/api/indexer/schemas'
import { resolveLenderNftOutpoint, resolveRepaymentOutpoint } from '@/api/indexer/utils'
import OfferActionShell from '@/components/modals/OfferActionShell'
import OfferDetailsBody from '@/components/modals/OfferDetailsBody'
import { getDefaultTransactionSteps } from '@/components/TransactionStepper/transactionSteps'
import { NETWORK_CONFIG } from '@/constants/network-config'
import { useLenderVaultClaim } from '@/hooks/useLenderVaultClaim'
import {
  estimateFeeBudgetSats,
  EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY,
  selectFeeUtxos,
  utxoToOutpointString,
} from '@/lwk/utxo'
import { useLwk } from '@/providers/lwk/useLwk'
import { usePendingTransactions } from '@/providers/pendingTransactions/usePendingTransactions'
import { useTxProgress } from '@/providers/txProgress/useTxProgress'
import { useWallet } from '@/providers/wallet/useWallet'
import { ASSET_AUTH_VAULT_MAX_WEIGHT_TO_SATISFY } from '@/simplicity/asset-auth-vault/program'
import { formatAmount } from '@/utils/format'
import { calcInterest } from '@/utils/offers'

const CLAIM_WEIGHT_UNITS =
  ASSET_AUTH_VAULT_MAX_WEIGHT_TO_SATISFY.WithdrawAll + EXPLICIT_SIGNATURE_MAX_WEIGHT_TO_SATISFY

interface ClaimModalProps {
  isOpen: boolean
  offer: OfferShort
  onClose: () => void
  onSuccess: () => void
}

export default function ClaimModal({ isOpen, offer, onClose, onSuccess }: ClaimModalProps) {
  const { principalAsset } = NETWORK_CONFIG
  const { syncWallet, getBlindedWalletUtxos, signPset, signerType, scriptPubkey } = useWallet()
  const { lwkNetwork } = useLwk()
  const { claimLenderVault } = useLenderVaultClaim()
  const { start, fail } = useTxProgress()
  const { addPendingTx } = usePendingTransactions()

  const claimVault = async () => {
    try {
      const advance = await start(getDefaultTransactionSteps(signerType))
      const fullOffer = await fetchOffer(offer.id)
      const vaultOutpoint = resolveRepaymentOutpoint(fullOffer)
      if (!vaultOutpoint) throw new Error('Lender vault UTXO not found')

      const lenderNftOutpoint = resolveLenderNftOutpoint(fullOffer)
      if (!lenderNftOutpoint) throw new Error('Lender NFT UTXO not found')

      await syncWallet()
      const [blindedWalletUtxos, feeRate] = await Promise.all([
        getBlindedWalletUtxos(),
        fetchFeeRateSatPerKvb(),
      ])
      const feeBudgetSats = estimateFeeBudgetSats(CLAIM_WEIGHT_UNITS, feeRate)
      const feeUtxos = selectFeeUtxos(
        blindedWalletUtxos,
        lwkNetwork.policyAsset(),
        feeBudgetSats,
        feeRate,
      )

      const { pset, finalize } = await claimLenderVault({
        lenderVaultOutpoint: vaultOutpoint,
        lenderNftOutpoint,
        feeOutpoints: feeUtxos.map(utxoToOutpointString),
      })

      await advance('signing')
      const signedPset = await signPset(pset)

      await advance('finalizing')
      const { finalizedTx, summary } = finalize(signedPset)

      await advance('broadcasting')
      const txid = await broadcastTx(finalizedTx.toString())

      return { txid, summary }
    } catch (err) {
      fail(err)
      throw err
    }
  }

  const { mutate, reset, data, status } = useMutation({
    mutationFn: claimVault,
    onSuccess: result => {
      void addPendingTx({
        txid: result.txid,
        kind: 'claim_interest',
        walletScriptPubkey: scriptPubkey ?? '',
        offerId: offer.id,
        previousOfferStatus: 'repaid',
        expectedOfferStatus: 'claimed',
      })
    },
  })

  const txSummary = useMemo(() => {
    const interestAmount = calcInterest(offer.principal_amount, offer.interest_rate)
    return [
      {
        label: 'Principal',
        value: `${formatAmount(offer.principal_amount, principalAsset.decimals)} ${principalAsset.symbol}`,
      },
      {
        label: 'Interest',
        value: `${formatAmount(interestAmount, principalAsset.decimals)} ${principalAsset.symbol}`,
      },
      {
        label: 'Total',
        value: `${formatAmount(offer.principal_amount + interestAmount, principalAsset.decimals)} ${principalAsset.symbol}`,
      },
    ]
  }, [offer, principalAsset])

  return (
    <OfferActionShell
      isOpen={isOpen}
      title='Claim Offer'
      chip={
        <Chip color='accent' variant='soft' size='sm'>
          Claim
        </Chip>
      }
      action={{
        label: 'Claim',
        eyebrow: 'Claim Vault',
        summary: txSummary,
        status,
        txid: data?.txid,
        onConfirm: () => mutate(),
      }}
      onClose={() => {
        reset()
        onClose()
      }}
      onSuccess={onSuccess}
    >
      <OfferDetailsBody offer={offer} />
    </OfferActionShell>
  )
}
