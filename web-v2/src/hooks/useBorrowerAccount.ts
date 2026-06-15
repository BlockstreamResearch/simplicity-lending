import {
  Address,
  assetIdFromIssuance,
  ContractHash,
  IssuanceRecipient,
  Script,
  TxBuilder,
  XOnlyPublicKey,
} from 'lwk_web'
import { useCallback } from 'react'

import { broadcastTx } from '@/api/esplora/methods'
import { isPolicyAssetUtxo, utxoToOutpointString } from '@/lwk/utxo'
import { getBorrowerAccount, saveBorrowerAccount } from '@/pages/Borrow/borrowerAccountStorage'
import { useLwk } from '@/providers/lwk/useLwk'
import { useWallet } from '@/providers/wallet/useWallet'
import { loadIssuanceFactoryProgram } from '@/simplicity/issuance-factory/program'
import { UNSPENDABLE_TAPROOT_PUBKEY } from '@/simplicity/taproot'
import { bytesToHex } from '@/utils/hex'
import { sha256 } from '@/utils/sha256'
import { toUint8, toUint64 } from '@/utils/uint'

const FEE_RESERVE = 250n
const ISSUING_UTXOS_COUNT = 2
const REISSUANCE_FLAGS = 0n
const ISSUANCE_AMOUNT = 2n
const REISSUANCE_TOKEN_AMOUNT = 0n
const FACTORY_AUTH_AMOUNT = 1n
const ISSUANCE_FACTORY_AMOUNT = 1n

export interface BorrowerAccountCreationResult {
  txid: string
  fundingOutpoint: string
  factoryAddress: string
  factoryAuthOutpoint: string
  issuanceFactoryOutpoint: string
  issuedAssetId: string
  metadataOpReturnHex: string
}

export interface BorrowerAccountRefs {
  factoryAssetId: string
  factoryAuthOutpoint: string
  issuanceFactoryOutpoint: string
}

export function useBorrowerAccount() {
  const { lwkNetwork } = useLwk()
  const { getReceiveAddress, getBlindedWalletUtxos, getWollet, signPset, xOnlyPubkey } = useWallet()

  // TODO: factory refs are persisted in localStorage as a temporary stopgap. Swap the restore/save
  // internals for an indexer lookup once the backend exposes borrower-account state — call sites stay the same.
  const restore = useCallback((): BorrowerAccountRefs => {
    const account = xOnlyPubkey ? getBorrowerAccount(xOnlyPubkey) : null
    if (!account) throw new Error('No borrower account found. Create one first.')
    if (!account.factoryAuthOutpoint) {
      throw new Error('Borrower account is outdated. Please re-create it.')
    }
    return {
      factoryAssetId: account.factoryAssetId,
      factoryAuthOutpoint: account.factoryAuthOutpoint,
      issuanceFactoryOutpoint: account.issuanceFactoryOutpoint,
    }
  }, [xOnlyPubkey])

  const save = useCallback(
    (refs: BorrowerAccountRefs): void => {
      if (xOnlyPubkey) saveBorrowerAccount(xOnlyPubkey, refs)
    },
    [xOnlyPubkey],
  )

  const hasAccount = Boolean(xOnlyPubkey && getBorrowerAccount(xOnlyPubkey)?.factoryAuthOutpoint)

  const createBorrowerAccount = async (): Promise<BorrowerAccountCreationResult> => {
    const receiveAddressString = await getReceiveAddress()
    if (!receiveAddressString) throw new Error('Missing receive address')

    const wollet = await getWollet()
    const policyAsset = lwkNetwork.policyAsset()
    const blindedWalletUtxos = await getBlindedWalletUtxos()

    const feeUtxo = blindedWalletUtxos
      .filter(utxo => isPolicyAssetUtxo(utxo, policyAsset))
      .filter(utxo => utxo.unblinded().value() > FEE_RESERVE)
      .sort((a, b) => Number(a.unblinded().value() - b.unblinded().value()))[0]

    if (!feeUtxo) throw new Error('Need a wallet L-BTC UTXO larger than the fee reserve')

    if (FACTORY_AUTH_AMOUNT + ISSUANCE_FACTORY_AMOUNT !== ISSUANCE_AMOUNT) {
      throw new Error('Invalid issuance split')
    }

    const fundingOutpoint = utxoToOutpointString(feeUtxo)
    const receiveAddress = Address.parse(receiveAddressString, lwkNetwork).toUnconfidential()
    const issuanceFactoryProgram = loadIssuanceFactoryProgram({
      issuingUtxosCount: toUint8(ISSUING_UTXOS_COUNT, 'issuingUtxosCount'),
      reissuanceFlags: toUint64(REISSUANCE_FLAGS, 'reissuanceFlags'),
    })
    const factoryAddress = issuanceFactoryProgram.createP2trAddress(
      XOnlyPublicKey.fromString(UNSPENDABLE_TAPROOT_PUBKEY),
      lwkNetwork,
    )
    const issuedAssetId = assetIdFromIssuance(feeUtxo.outpoint(), emptyContractHash())
    const metadata = await buildMetadata()

    const pset = new TxBuilder(lwkNetwork)
      .setWalletUtxos([feeUtxo.outpoint()])
      .issueAssetToRecipients(
        [
          IssuanceRecipient.fromAddress(FACTORY_AUTH_AMOUNT, receiveAddress),
          IssuanceRecipient.fromAddress(ISSUANCE_FACTORY_AMOUNT, factoryAddress),
        ],
        REISSUANCE_TOKEN_AMOUNT,
        null,
        null,
      )
      .addExplicitScriptOutput(Script.newOpReturn(metadata), 0n, policyAsset)
      .finish(wollet)

    const signedPset = await signPset(pset)
    const finalizedPset = wollet.finalize(signedPset)
    const txid = await broadcastTx(finalizedPset.extractTx().toString())

    const result: BorrowerAccountCreationResult = {
      txid,
      fundingOutpoint,
      factoryAddress: factoryAddress.toString(),
      factoryAuthOutpoint: `${txid}:0`,
      issuanceFactoryOutpoint: `${txid}:1`,
      issuedAssetId: issuedAssetId.toString(),
      metadataOpReturnHex: bytesToHex(Script.newOpReturn(metadata).bytes()),
    }

    save({
      factoryAssetId: result.issuedAssetId,
      factoryAuthOutpoint: result.factoryAuthOutpoint,
      issuanceFactoryOutpoint: result.issuanceFactoryOutpoint,
    })

    return result
  }

  const removeBorrowerAccount = async (): Promise<void> => {
    throw new Error(
      'Remove is scaffolded but not wired: the wallet connector must expose Schnorr signing for IssuanceFactory sig_all_hash.',
    )
  }

  return { createBorrowerAccount, restore, save, hasAccount, removeBorrowerAccount }
}

function emptyContractHash(): ContractHash {
  return ContractHash.fromBytes(new Uint8Array(32))
}

async function buildMetadata(): Promise<Uint8Array> {
  const { sources } = await import('virtual:simplicity-sources')
  const hash = await sha256(new TextEncoder().encode(sources.issuance_factory))
  const programId = new Uint8Array(hash).slice(0, 4)
  const data = new Uint8Array(13)
  data.set(programId, 0)
  data[4] = ISSUING_UTXOS_COUNT
  new DataView(data.buffer).setBigUint64(5, REISSUANCE_FLAGS, true)
  return data
}
