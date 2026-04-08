/* tslint:disable */
/* eslint-disable */
/**
 * Generate the asset entropy from the issuance prevout and the contract hash.
 */
export function generateAssetEntropy(outpoint: OutPoint, contract_hash: ContractHash): ContractHash;
/**
 * Compute the asset ID from an issuance outpoint and contract hash.
 */
export function assetIdFromIssuance(outpoint: OutPoint, contract_hash: ContractHash): AssetId;
/**
 * Compute the reissuance token ID from an issuance outpoint and contract hash.
 */
export function reissuanceTokenFromIssuance(outpoint: OutPoint, contract_hash: ContractHash, is_confidential: boolean): AssetId;
export function searchLedgerDevice(): Promise<HIDDevice>;
/**
 * Convert bytes to hex string.
 * TODO: this is a function for convenience, it is going to be deleted after all interfaces are
 * finalized (simplicity related)
 */
export function bytesToHex(bytes: Uint8Array): string;
/**
 * Get the x-only public key for a given derivation path from a signer.
 * TODO: move to the Signer structure
 */
export function simplicityDeriveXonlyPubkey(signer: Signer, derivation_path: string): XOnlyPublicKey;
/**
 * Compute the Taproot control block for Simplicity script-path spending.
 */
export function simplicityControlBlock(cmr: Cmr, internal_key: XOnlyPublicKey): ControlBlock;
/**
 * Convert the given string to a QR code image uri
 *
 * The image format is monocromatic bitmap, returned as an encoded in base64 uri.
 *
 * Without `pixel_per_module` the default is no border, and 1 pixel per module, to be used
 * for example in html: `style="image-rendering: pixelated; border: 20px solid white;"`
 */
export function stringToQr(str: string, pixel_per_module?: number | null): string;
/**
 * Wallet chain
 */
export enum Chain {
  /**
   * External address, shown when asked for a payment.
   * Wallet having a single descriptor are considered External
   */
  External = 0,
  /**
   * Internal address, used for the change
   */
  Internal = 1,
}
/**
 * Log level for Simplicity program execution tracing.
 */
export enum SimplicityLogLevel {
  /**
   * No output during execution.
   */
  None = 0,
  /**
   * Print debug information.
   */
  Debug = 1,
  /**
   * Print debug and warning information.
   */
  Warning = 2,
  /**
   * Print debug, warning, and jet execution trace.
   */
  Trace = 3,
}
/**
 * An Elements (Liquid) address
 */
export class Address {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates an `Address`
   *
   * If you know the network, you can use `parse()` to validate that the network is consistent.
   */
  constructor(s: string);
  /**
   * Parses an `Address` ensuring is for the right network
   */
  static parse(s: string, network: Network): Address;
  /**
   * Return the script pubkey of the address.
   */
  scriptPubkey(): Script;
  /**
   * Return true if the address is blinded, in other words, if it has a blinding key.
   */
  isBlinded(): boolean;
  /**
   * Return true if the address is for mainnet.
   */
  isMainnet(): boolean;
  /**
   * Return the unconfidential address, in other words, the address without the blinding key.
   */
  toUnconfidential(): Address;
  /**
   * Return the string representation of the address.
   * This representation can be used to recreate the address via `new()`
   */
  toString(): string;
  /**
   * Returns a string encoding an image in a uri
   *
   * The string can be open in the browser or be used as `src` field in `img` in HTML
   *
   * For max efficiency we suggest to pass `None` to `pixel_per_module`, get a very small image
   * and use styling to scale up the image in the browser. eg
   * `style="image-rendering: pixelated; border: 20px solid white;"`
   */
  QRCodeUri(pixel_per_module?: number | null): string;
  /**
   * Returns a string of the QR code printable in a terminal environment
   */
  QRCodeText(): string;
}
/**
 * Value returned from asking an address to the wallet.
 * Containing the confidential address and its
 * derivation index (the last element in the derivation path)
 */
export class AddressResult {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Return the address.
   */
  address(): Address;
  /**
   * Return the derivation index of the address.
   */
  index(): number;
}
/**
 * Context for actions related to an AMP0 (sub)account
 *
 * <div class="warning">
 * <b>WARNING:</b>
 *
 * AMP0 is based on a legacy system, and some things do not fit precisely the way LWK allows to do
 * things.
 *
 * Callers must be careful with the following:
 * * <b>Addresses: </b>
 *   to get addresses use [`Amp0::address()`]. This ensures
 *   that all addresses used are correctly monitored by the AMP0 server.
 * * <b>Syncing: </b>
 *   to sync the AMP0 [`crate::Wollet`], use [`Amp0::last_index()`] and [`crate::clients::blocking::BlockchainBackend::full_scan_to_index()`]. This ensures that all utxos are synced, even if there are gaps between higher than the GAP LIMIT.
 *
 * <i>
 * Failing to do the above might lead to inconsistent states, where funds are not shown or they
 * cannot be spent!
 * </i>
 * </div>
 */
export class Amp0 {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a new AMP0 context for the specified network
   */
  static newWithNetwork(network: Network, username: string, password: string, amp_id: string): Promise<Amp0>;
  /**
   * Create a new AMP0 context for testnet
   */
  static newTestnet(username: string, password: string, amp_id: string): Promise<Amp0>;
  /**
   * Create a new AMP0 context for mainnet
   */
  static newMainnet(username: string, password: string, amp_id: string): Promise<Amp0>;
  /**
   * Index of the last returned address
   *
   * Use this and [`crate::EsploraClient::full_scan_to_index()`] to sync the `Wollet`
   */
  lastIndex(): number;
  /**
   * AMP ID
   */
  ampId(): string;
  /**
   * Get an address
   *
   * If `index` is None, a new address is returned.
   */
  address(index?: number | null): Promise<AddressResult>;
  /**
   * The LWK watch-only wallet corresponding to the AMP0 (sub)account.
   */
  wollet(): Wollet;
  /**
   * Ask AMP0 server to cosign
   */
  sign(amp0pset: Amp0Pset): Promise<Transaction>;
}
/**
 * Session connecting to AMP0
 */
export class Amp0Connected {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Connect and register to AMP0
   */
  constructor(network: Network, signer_data: Amp0SignerData);
  /**
   * Obtain a login challenge
   *
   * This must be signed with [`amp0_sign_challenge()`].
   */
  getChallenge(): Promise<string>;
  /**
   * Log in
   *
   * `sig` must be obtained from [`amp0_sign_challenge()`] called with the value returned
   * by [`Amp0Connected::get_challenge()`]
   */
  login(sig: string): Promise<Amp0LoggedIn>;
}
/**
 * Session logged in AMP0
 */
export class Amp0LoggedIn {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * List of AMP IDs.
   */
  getAmpIds(): string[];
  /**
   * Get the next account for AMP0 account creation
   *
   * This must be given to [`amp0_account_xpub()`] to obtain the xpub to pass to
   * [`Amp0LoggedIn::create_amp0_account()`]
   */
  nextAccount(): number;
  /**
   * Create a new AMP0 account
   *
   * `account_xpub` must be obtained from [`amp0_account_xpub()`] called with the value obtained from
   * [`Amp0LoggedIn::next_account()`]
   */
  createAmp0Account(pointer: number, account_xpub: string): Promise<string>;
  /**
   * Create a new Watch-Only entry for this wallet
   */
  createWatchOnly(username: string, password: string): Promise<void>;
}
/**
 * A PSET to use with AMP0
 *
 * When asking AMP0 to cosign, the caller must pass some extra data that does not belong to the
 * PSET. This struct holds and manage the necessary data.
 *
 * If you're not dealing with AMP0, do not use this struct.
 */
export class Amp0Pset {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates a `Amp0Pset`
   */
  constructor(pset: Pset, blinding_nonces: string[]);
  /**
   * Get the PSET
   */
  pset(): Pset;
  /**
   * Get the blinding nonces
   */
  blindingNonces(): string[];
}
export class Amp0SignerData {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
}
/**
 * Context for actions interacting with Asset Management Platform version 2
 */
export class Amp2 {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a new AMP2 client with the default url and server key for the testnet network.
   */
  static newTestnet(): Amp2;
  /**
   * Get an AMP2 wallet descriptor from the keyorigin xpub string obtained from a signer
   */
  descriptorFromStr(keyorigin_xpub: string): Amp2Descriptor;
  /**
   * Register an AMP2 wallet with the AMP2 server
   */
  register(desc: Amp2Descriptor): Promise<string>;
  /**
   * Ask the AMP2 server to cosign a PSET
   */
  cosign(pset: Pset): Promise<Pset>;
}
/**
 * An Asset Management Platform version 2 descriptor
 */
export class Amp2Descriptor {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Return the descriptor as a `WolletDescriptor`
   */
  descriptor(): WolletDescriptor;
  /**
   * Return the string representation of the descriptor.
   */
  toString(): string;
}
/**
 * An asset identifier and an amount in satoshi units
 */
export class AssetAmount {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  amount(): bigint;
  asset(): AssetId;
}
/**
 * A blinding factor for asset commitments.
 */
export class AssetBlindingFactor {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates an `AssetBlindingFactor` from a string.
   */
  static fromString(s: string): AssetBlindingFactor;
  /**
   * Creates an `AssetBlindingFactor` from a byte slice.
   */
  static fromBytes(bytes: Uint8Array): AssetBlindingFactor;
  /**
   * Returns a zero asset blinding factor.
   */
  static zero(): AssetBlindingFactor;
  /**
   * Returns the bytes (32 bytes) in little-endian byte order.
   *
   * This is the internal representation used by secp256k1. The byte order is
   * reversed compared to the hex string representation (which uses big-endian,
   * following Bitcoin display conventions).
   */
  toBytes(): Uint8Array;
  /**
   * Returns string representation of the ABF
   */
  toString(): string;
}
/**
 * A valid asset identifier.
 *
 * 32 bytes encoded as hex string.
 */
export class AssetId {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates an `AssetId`
   *
   * Deprecated: use `from_string()` instead
   */
  constructor(asset_id: string);
  /**
   * Creates an `AssetId` from hex string
   */
  static fromString(s: string): AssetId;
  /**
   * Creates an `AssetId` from a bytes.
   */
  static fromBytes(bytes: Uint8Array): AssetId;
  /**
   * Returns the `AssetId` bytes in little-endian byte order.
   */
  toBytes(): Uint8Array;
  /**
   * Return the string representation of the asset identifier (64 hex characters).
   * This representation can be used to recreate the asset identifier via `fromString()`
   */
  toString(): string;
}
/**
 * An ordered collection of asset identifiers.
 */
export class AssetIds {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Return an empty list of asset identifiers.
   */
  static empty(): AssetIds;
  /**
   * Return the string representation of this list of asset identifiers.
   */
  toString(): string;
}
/**
 * Data related to an asset in the registry:
 * - contract: the contract of the asset
 * - tx: the issuance transaction of the asset
 */
export class AssetMeta {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Return the contract of the asset.
   */
  contract(): Contract;
  /**
   * Return the issuance transaction of the asset.
   */
  tx(): Transaction;
}
/**
 * A signed balance of assets, to represent a balance with negative values such
 * as the results of a transaction from the perspective of a wallet.
 */
export class Balance {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Convert the balance to a JsValue for serialization
   *
   * Note: the amounts are strings since `JSON.stringify` cannot handle `BigInt`s.
   * Use `entries()` to get the raw data.
   */
  toJSON(): any;
  /**
   * Returns the balance as an array of [key, value] pairs.
   */
  entries(): any;
  /**
   * Return the string representation of the balance.
   */
  toString(): string;
}
/**
 * The bip variant for a descriptor like specified in the bips (49, 84, 87)
 */
export class Bip {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates a bip49 variant
   */
  static bip49(): Bip;
  /**
   * Creates a bip84 variant
   */
  static bip84(): Bip;
  /**
   * Creates a bip87 variant
   */
  static bip87(): Bip;
  /**
   * Return the string representation of the bip variant, such as "bip49", "bip84" or "bip87"
   */
  toString(): string;
}
/**
 * A Liquid block header
 */
export class BlockHeader {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Get the block hash as a hex string
   */
  blockHash(): string;
  /**
   * Get the previous block hash as a hex string
   */
  prevBlockhash(): string;
  /**
   * Get the merkle root as a hex string
   */
  merkleRoot(): string;
  /**
   * Get the block timestamp
   */
  time(): number;
  /**
   * Get the block version
   */
  version(): number;
  /**
   * Get the block height
   */
  height(): number;
}
/**
 * Wrapper over [`lwk_boltz::BoltzSession`]
 */
export class BoltzSession {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Get the rescue file
   */
  rescueFile(): string;
  /**
   * Prepare a lightning invoice payment
   */
  preparePay(lightning_payment: LightningPayment, refund_address: Address): Promise<PreparePayResponse>;
  /**
   * Create a lightning invoice for receiving payment
   */
  invoice(amount: bigint, description: string | null | undefined, claim_address: Address): Promise<InvoiceResponse>;
  /**
   * Restore a swap from its serialized data
   */
  restorePreparePay(data: string): Promise<PreparePayResponse>;
  /**
   * Restore a swap from its serialized data
   */
  restoreInvoice(data: string): Promise<InvoiceResponse>;
}
/**
 * Wrapper over [`lwk_boltz::BoltzSessionBuilder`]
 */
export class BoltzSessionBuilder {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a new BoltzSessionBuilder with the given network
   *
   * This creates a builder with default Esplora client for the network.
   */
  constructor(network: Network, esplora_client: EsploraClient);
  /**
   * Set the timeout for creating swaps
   *
   * If not set, the default timeout of 10 seconds is used.
   */
  createSwapTimeout(timeout_seconds: bigint): BoltzSessionBuilder;
  /**
   * Set the timeout for the advance call
   *
   * If not set, the default timeout of 3 minutes is used.
   */
  timeoutAdvance(timeout_seconds: bigint): BoltzSessionBuilder;
  /**
   * Set the mnemonic for deriving swap keys
   *
   * If not set, a new random mnemonic will be generated.
   */
  mnemonic(mnemonic: Mnemonic): BoltzSessionBuilder;
  /**
   * Set the polling flag
   *
   * If true, the advance call will not await on the websocket connection returning immediately
   * even if there is no update, thus requiring the caller to poll for updates.
   *
   * If true, the timeout_advance will be ignored even if set.
   */
  polling(polling: boolean): BoltzSessionBuilder;
  /**
   * Set the next index to use for deriving keypairs
   *
   * Avoid a call to the boltz API to recover this information.
   *
   * When the mnemonic is not set, this is ignored.
   */
  nextIndexToUse(next_index_to_use: number): BoltzSessionBuilder;
  /**
   * Set the referral id for the BoltzSession
   */
  referralId(referral_id: string): BoltzSessionBuilder;
  /**
   * Set the url of the bitcoin electrum client
   */
  bitcoinElectrumClient(bitcoin_electrum_client: string): BoltzSessionBuilder;
  /**
   * Set the random preimages flag
   *
   * The default is false, the preimages will be deterministic and the rescue file will be
   * compatible with the Boltz web app.
   * If true, the preimages will be random potentially allowing concurrent sessions with the same
   * mnemonic, but completing the swap will be possible only with the preimage data. For example
   * the boltz web app will be able only to refund the swap, not to bring it to completion.
   * If true, when serializing the swap data, the preimage will be saved in the data.
   */
  randomPreimages(random_preimages: boolean): BoltzSessionBuilder;
  /**
   * Build the BoltzSession
   */
  build(): Promise<BoltzSession>;
}
/**
 * Commitment Merkle root
 *
 * A Merkle root that commits to a node's combinator and recursively its children.
 */
export class Cmr {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a CMR from bytes (32 bytes).
   */
  static fromBytes(bytes: Uint8Array): Cmr;
  /**
   * Create a CMR from a string.
   */
  static fromString(s: string): Cmr;
  /**
   * Return the raw CMR bytes (32 bytes).
   */
  toBytes(): Uint8Array;
  /**
   * Return the string representation.
   */
  toString(): string;
}
/**
 * A contract defining metadata of an asset such the name and the ticker
 */
export class Contract {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates a `Contract`
   */
  constructor(domain: string, issuer_pubkey: string, name: string, precision: number, ticker: string, version: number);
  /**
   * Return the string representation of the contract.
   */
  toString(): string;
  /**
   * Return the domain of the issuer of the contract.
   */
  domain(): string;
  /**
   * Make a copy of the contract.
   *
   * This is needed to pass it to a function that requires a `Contract` (without borrowing)
   * but you need the same contract after that call.
   */
  clone(): Contract;
}
/**
 * The hash of an asset contract.
 */
export class ContractHash {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates a `ContractHash` from a string.
   */
  static fromString(s: string): ContractHash;
  /**
   * Creates a `ContractHash` from a byte slice.
   */
  static fromBytes(bytes: Uint8Array): ContractHash;
  /**
   * Returns the bytes (32 bytes).
   */
  toBytes(): Uint8Array;
  /**
   * Returns the string representation.
   */
  toString(): string;
}
/**
 * A control block for Taproot script-path spending.
 */
export class ControlBlock {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Parse a control block from serialized bytes.
   */
  static fromBytes(bytes: Uint8Array): ControlBlock;
  /**
   * Serialize the control block to bytes.
   */
  toBytes(): Uint8Array;
  /**
   * Get the leaf version of the control block.
   */
  leafVersion(): number;
  /**
   * Get the internal key of the control block.
   */
  internalKey(): XOnlyPublicKey;
  /**
   * Get the output key parity (0 for even, 1 for odd).
   */
  outputKeyParity(): number;
  /**
   * Get the size of the control block in bytes.
   */
  size(): number;
}
export class CurrencyCode {
  free(): void;
  [Symbol.dispose](): void;
  constructor(code: string);
  name(): string;
  alpha3(): string;
  exp(): number;
}
/**
 * A blockchain backend implementation based on the
 * [esplora HTTP API](https://github.com/blockstream/esplora/blob/master/API.md).
 * But can also use the [waterfalls](https://github.com/RCasatta/waterfalls)
 * endpoint to speed up the scan if supported by the server.
 */
export class EsploraClient {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates an Esplora client with the given options
   */
  constructor(network: Network, url: string, waterfalls: boolean, concurrency: number, utxo_only: boolean);
  /**
   * Scan the blockchain for the scripts generated by a watch-only wallet
   *
   * This method scans both external and internal address chains, stopping after finding
   * 20 consecutive unused addresses (the gap limit) as recommended by
   * [BIP44](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki#address-gap-limit).
   *
   * Returns `Some(Update)` if any changes were found during scanning, or `None` if no changes
   * were detected.
   *
   * To scan beyond the gap limit use `full_scan_to_index()` instead.
   */
  fullScan(wollet: Wollet): Promise<Update | undefined>;
  /**
   * Scan the blockchain for the scripts generated by a watch-only wallet up to a specified derivation index
   *
   * While `full_scan()` stops after finding 20 consecutive unused addresses (the gap limit),
   * this method will scan at least up to the given derivation index. This is useful to prevent
   * missing funds in cases where outputs exist beyond the gap limit.
   *
   * Will scan both external and internal address chains up to the given index for maximum safety,
   * even though internal addresses may not need such deep scanning.
   *
   * If transactions are found beyond the gap limit during this scan, subsequent calls to
   * `full_scan()` will automatically scan up to the highest used index, preventing any
   * previously-found transactions from being missed.
   *
   * See `full_scan_to_index()` for a blocking version of this method.
   */
  fullScanToIndex(wollet: Wollet, index: number): Promise<Update | undefined>;
  /**
   * Broadcast a transaction to the network so that a miner can include it in a block.
   */
  broadcastTx(tx: Transaction): Promise<Txid>;
  /**
   * Broadcast a PSET by extracting the transaction from the PSET and broadcasting it.
   */
  broadcast(pset: Pset): Promise<Txid>;
  /**
   * Set the waterfalls server recipient key. This is used to encrypt the descriptor when calling the waterfalls endpoint.
   */
  setWaterfallsServerRecipient(recipient: string): Promise<void>;
  /**
   * Query the last used derivation index for a wallet's descriptor from the waterfalls server.
   *
   * This method queries the waterfalls `/v1/last_used_index` endpoint to get the last used
   * derivation index for both external and internal chains of the wallet's descriptor.
   *
   * Returns `LastUsedIndexResponse` containing the last used indexes and the tip block hash.
   *
   * # Errors
   *
   * Returns an error if this client was not configured with waterfalls support,
   * if the descriptor does not contain a wildcard,
   * or if the descriptor uses ELIP151 blinding.
   */
  lastUsedIndex(descriptor: WolletDescriptor): Promise<LastUsedIndexResponse>;
}
/**
 * Multiple exchange rates against BTC provided from various sources
 */
export class ExchangeRates {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Get the median exchange rate
   */
  median(): number;
  /**
   * Get the individual exchange rates as a JSON array
   *
   * Each rate contains: rate, currency, source, and timestamp
   */
  results(): any;
  /**
   * Get the number of sources that provided rates
   */
  resultsCount(): number;
  /**
   * Serialize the entire response to JSON string
   */
  serialize(): string;
}
/**
 * An external UTXO, owned by another wallet.
 */
export class ExternalUtxo {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Construct an ExternalUtxo
   */
  constructor(vout: number, tx: Transaction, unblinded: TxOutSecrets, max_weight_to_satisfy: number, is_segwit: boolean);
}
/**
 * Wrapper over [`lwk_boltz::InvoiceResponse`]
 */
export class InvoiceResponse {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Serialize the response to JSON string for JS interop
   */
  serialize(): string;
  /**
   * Return the bolt11 invoice string
   */
  bolt11Invoice(): string;
  swapId(): string;
  /**
   * The fee of the swap provider
   *
   * It is equal to the amount of the invoice minus the amount of the onchain transaction.
   * Does not include the fee of the onchain transaction.
   */
  fee(): bigint | undefined;
  /**
   * Complete the payment by advancing through the swap states until completion or failure
   * Consumes self as the inner method does
   */
  completePay(): Promise<boolean>;
}
/**
 * The details of an issuance or reissuance.
 */
export class Issuance {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Return the asset id or None if it's a null issuance
   */
  asset(): AssetId | undefined;
  /**
   * Return the token id or None if it's a null issuance
   */
  token(): AssetId | undefined;
  /**
   * Return the previous output index or None if it's a null issuance
   */
  prevVout(): number | undefined;
  /**
   * Return the previous transaction id or None if it's a null issuance
   */
  prevTxid(): Txid | undefined;
  /**
   * Return true if this is effectively an issuance
   */
  isIssuance(): boolean;
  /**
   * Return true if this is effectively a reissuance
   */
  isReissuance(): boolean;
}
/**
 * A Jade hardware wallet usable via Web Serial
 */
export class Jade {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates a Jade from Web Serial for the given network
   *
   * When filter is true, it will filter available serial with Blockstream released chips, use
   * false if you don't see your DYI jade
   */
  constructor(network: Network, filter: boolean);
  getVersion(): Promise<any>;
  getMasterXpub(): Promise<Xpub>;
  /**
   * Return a single sig address with the given `variant` and `path` derivation
   */
  getReceiveAddressSingle(variant: Singlesig, path: Uint32Array): Promise<string>;
  /**
   * Return a multisig address of a registered `multisig_name` wallet
   *
   * This method accept `path` and `path_n` in place of a single `Vec<Vec<u32>>` because the
   * latter is not supported by wasm_bindgen (and neither `(u32, Vec<u32>)`). `path` and `path_n`
   * are converted internally to a `Vec<Vec<u32>>` with the caveat all the paths are the same,
   * which is almost always the case.
   */
  getReceiveAddressMulti(multisig_name: string, path: Uint32Array): Promise<string>;
  /**
   * Sign and consume the given PSET, returning the signed one
   */
  sign(pset: Pset): Promise<Pset>;
  wpkh(): Promise<WolletDescriptor>;
  shWpkh(): Promise<WolletDescriptor>;
  multi(name: string): Promise<WolletDescriptor>;
  getRegisteredMultisigs(): Promise<any>;
  keyoriginXpub(bip: Bip): Promise<string>;
  registerDescriptor(name: string, desc: WolletDescriptor): Promise<boolean>;
}
/**
 * WebSocket-based `Jade` useful for testing in the browser with the Jade emulator.
 */
export class JadeWebSocket {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates a Jade from WebSocket for the given network
   *
   * The url should point to your WebSocket bridge that connects to the Docker Jade emulator
   */
  constructor(network: Network, url: string);
  getVersion(): Promise<any>;
  getMasterXpub(): Promise<Xpub>;
  /**
   * Return a single sig address with the given `variant` and `path` derivation
   */
  getReceiveAddressSingle(variant: Singlesig, path: Uint32Array): Promise<string>;
  /**
   * Return a multisig address of a registered `multisig_name` wallet
   *
   * This method accept `path` and `path_n` in place of a single `Vec<Vec<u32>>` because the
   * latter is not supported by wasm_bindgen (and neither `(u32, Vec<u32>)`). `path` and `path_n`
   * are converted internally to a `Vec<Vec<u32>>` with the caveat all the paths are the same,
   * which is almost always the case.
   */
  getReceiveAddressMulti(multisig_name: string, path: Uint32Array): Promise<string>;
  /**
   * Sign and consume the given PSET, returning the signed one
   */
  sign(pset: Pset): Promise<Pset>;
  wpkh(): Promise<WolletDescriptor>;
  shWpkh(): Promise<WolletDescriptor>;
  multi(name: string): Promise<WolletDescriptor>;
  getRegisteredMultisigs(): Promise<any>;
  keyoriginXpub(bip: Bip): Promise<string>;
  registerDescriptor(name: string, desc: WolletDescriptor): Promise<boolean>;
}
/**
 * A bridge that connects a [`JsStorage`] to [`lwk_common::Store`].
 */
export class JsStoreLink {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a new `JsStoreLink` from a JavaScript storage object.
   *
   * The JS object must have `get(key)`, `put(key, value)`, and `remove(key)` methods.
   */
  constructor(storage: any);
}
/**
 * Test helper to verify Rust can read/write through a JS store.
 */
export class JsTestStore {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a new test helper wrapping the given JS storage.
   */
  constructor(storage: any);
  /**
   * Write a key-value pair to the store.
   */
  write(key: string, value: Uint8Array): void;
  /**
   * Read a value from the store.
   */
  read(key: string): Uint8Array | undefined;
  /**
   * Remove a key from the store.
   */
  remove(key: string): void;
}
/**
 * A secp256k1 keypair
 */
export class Keypair {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates a `Keypair` from a 32-byte secret key
   */
  static fromSecretBytes(secret_bytes: Uint8Array): Keypair;
  /**
   * Creates a `Keypair` from a `SecretKey`
   */
  static fromSecretKey(sk: SecretKey): Keypair;
  /**
   * Generates a new random keypair
   */
  static generate(): Keypair;
  /**
   * Returns the secret key bytes (32 bytes)
   */
  secretBytes(): Uint8Array;
  /**
   * Returns the `SecretKey`
   */
  secretKey(): SecretKey;
  /**
   * Returns the `PublicKey`
   */
  publicKey(): PublicKey;
  /**
   * Returns the x-only public key
   */
  xOnlyPublicKey(): XOnlyPublicKey;
  /**
   * Signs a 32-byte message hash using Schnorr signature
   *
   * Takes the message as a hex string (64 hex chars = 32 bytes)
   * Returns the signature as a hex string (128 hex chars = 64 bytes)
   */
  signSchnorr(msg_hex: string): string;
}
/**
 * Response from the last_used_index endpoint
 *
 * Returns the highest derivation index that has been used (has transaction history)
 * for both external and internal chains. This is useful for quickly determining
 * the next unused address without downloading full transaction history.
 */
export class LastUsedIndexResponse {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Last used index on the external (receive) chain, or undefined if no addresses have been used.
   */
  readonly external: number | undefined;
  /**
   * Last used index on the internal (change) chain, or undefined if no addresses have been used.
   */
  readonly internal: number | undefined;
  /**
   * Current blockchain tip hash for reference.
   */
  readonly tip: string | undefined;
}
export class LedgerWeb {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * hid_device must be already opened
   */
  constructor(hid_device: HIDDevice, network: Network);
  getVersion(): Promise<string>;
  deriveXpub(path: string): Promise<string>;
  slip77MasterBlindingKey(): Promise<string>;
  fingerprint(): Promise<string>;
  /**
   * TODO Should use Signer::wpkh_slip77_descriptor
   */
  wpkhSlip77Descriptor(): Promise<WolletDescriptor>;
  /**
   * Sign and consume the given PSET, returning the signed one
   */
  sign(pset: Pset): Promise<Pset>;
  /**
   * Return a single sig address with the given `variant` and `index`
   */
  getReceiveAddressSingle(index: number): Promise<string>;
}
/**
 * Wrapper over [`lwk_boltz::LightningPayment`]
 */
export class LightningPayment {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a LightningPayment from a bolt11 invoice string or a bolt12 offer
   */
  constructor(invoice: string);
  /**
   * Return a string representation of the LightningPayment
   */
  toString(): string;
  /**
   * Return a QR code image uri for the LightningPayment
   */
  toUriQr(pixel_per_module?: number | null): string;
}
/**
 * Transaction lock time.
 */
export class LockTime {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a LockTime from a consensus u32 value.
   */
  constructor(value: number);
  /**
   * Create a LockTime from a block height.
   */
  static from_height(height: number): LockTime;
  /**
   * Create a LockTime from a Unix timestamp.
   */
  static from_time(time: number): LockTime;
  /**
   * Create a LockTime with value zero (no lock time).
   */
  static zero(): LockTime;
  /**
   * Return the consensus u32 value.
   */
  to_consensus_u32(): number;
  /**
   * Return true if this lock time represents a block height.
   */
  is_block_height(): boolean;
  /**
   * Return true if this lock time represents a Unix timestamp.
   */
  is_block_time(): boolean;
  /**
   * Return the string representation.
   */
  toString(): string;
}
/**
 * A struct representing a magic routing hint, with details on how to pay directly without using Boltz
 */
export class MagicRoutingHint {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * The address to pay directly to
   */
  address(): string;
  /**
   * The amount to pay directly to
   */
  amount(): bigint;
  /**
   * The URI to pay directly to
   */
  uri(): string;
}
/**
 * A mnemonic secret code used as a master secret for a bip39 wallet.
 *
 * Supported number of words are 12, 15, 18, 21, and 24.
 */
export class Mnemonic {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates a Mnemonic
   */
  constructor(s: string);
  /**
   * Return the string representation of the Mnemonic.
   * This representation can be used to recreate the Mnemonic via `new()`
   *
   * Note this is secret information, do not log it.
   */
  toString(): string;
  /**
   * Creates a Mnemonic from entropy, at least 16 bytes are needed.
   */
  static fromEntropy(b: Uint8Array): Mnemonic;
  /**
   * Creates a random Mnemonic of given words (12,15,18,21,24)
   */
  static fromRandom(word_count: number): Mnemonic;
}
/**
 * The network of the elements blockchain such as mainnet, testnet or regtest.
 */
export class Network {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates a mainnet `Network``
   */
  static mainnet(): Network;
  /**
   * Creates a testnet `Network``
   */
  static testnet(): Network;
  /**
   * Creates a regtest `Network``
   */
  static regtest(policy_asset: AssetId): Network;
  /**
   * Creates the default regtest `Network` with the policy asset `5ac9f65c0efcc4775e0baec4ec03abdde22473cd3cf33c0419ca290e0751b225`
   */
  static regtestDefault(): Network;
  /**
   * Return the default esplora client for this network
   */
  defaultEsploraClient(): EsploraClient;
  /**
   * Return true if the network is a mainnet network
   */
  isMainnet(): boolean;
  /**
   * Return true if the network is a testnet network
   */
  isTestnet(): boolean;
  /**
   * Return true if the network is a regtest network
   */
  isRegtest(): boolean;
  /**
   * Return a string representation of the network, like "liquid", "liquid-testnet" or "liquid-regtest"
   */
  toString(): string;
  /**
   * Return the policy asset for this network
   */
  policyAsset(): AssetId;
  /**
   * Return the genesis block hash for this network as hex string.
   */
  genesisBlockHash(): string;
  /**
   * Return the transaction builder for this network
   */
  txBuilder(): TxBuilder;
  /**
   * Return the default explorer URL for this network
   */
  defaultExplorerUrl(): string;
}
/**
 * An optional wallet transaction output. Could be None when it's not possible to unblind.
 * It seems required by wasm_bindgen because we can't return `Vec<Option<WalletTxOut>>`
 */
export class OptionWalletTxOut {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Return a copy of the WalletTxOut if it exists, otherwise None
   */
  get(): WalletTxOut | undefined;
}
/**
 * A reference to a transaction output
 */
export class OutPoint {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates an `OutPoint` from a string representation.
   */
  constructor(s: string);
  /**
   * Creates an `OutPoint` from a transaction ID and output index.
   */
  static fromParts(txid: Txid, vout: number): OutPoint;
  /**
   * Return the transaction identifier.
   */
  txid(): Txid;
  /**
   * Return the output index.
   */
  vout(): number;
}
/**
 * POS (Point of Sale) configuration for encoding/decoding
 */
export class PosConfig {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a new POS configuration
   */
  constructor(descriptor: WolletDescriptor, currency: CurrencyCode);
  /**
   * Create a POS configuration with all options
   */
  static withOptions(descriptor: WolletDescriptor, currency: CurrencyCode, show_gear?: boolean | null, show_description?: boolean | null): PosConfig;
  /**
   * Decode a POS configuration from a URL-safe base64 encoded string
   */
  static decode(encoded: string): PosConfig;
  /**
   * Encode the POS configuration to a URL-safe base64 string
   */
  encode(): string;
  /**
   * Return a string representation of the POS configuration
   */
  toString(): string;
  /**
   * Get the wallet descriptor
   */
  readonly descriptor: WolletDescriptor;
  /**
   * Get the currency code
   */
  readonly currency: CurrencyCode;
  /**
   * Get whether to show the gear/settings button
   */
  readonly showGear: boolean | undefined;
  /**
   * Get whether to show the description/note field
   */
  readonly showDescription: boolean | undefined;
}
/**
 * Helper to convert satoshi values of an asset to the value with the given precision and viceversa.
 *
 * For example 100 satoshi with precision 2 is "1.00"
 */
export class Precision {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a new Precision, useful to encode e decode values for assets with precision.
   * erroring if the given precision is greater than the allowed maximum (8)
   */
  constructor(precision: number);
  /**
   * Convert the given satoshi value to the formatted value according to our precision
   *
   * For example 100 satoshi with precision 2 is "1.00"
   */
  satsToString(sats: bigint): string;
  /**
   * Convert the given string with precision to satoshi units.
   *
   * For example the string "1.00" of an asset with precision 2 is 100 satoshi.
   */
  stringToSats(sats: string): bigint;
}
export class PreparePayResponse {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Serialize the response to JSON string for JS interop
   */
  serialize(): string;
  swapId(): string;
  uri(): string;
  uriAddress(): Address;
  uriAmount(): bigint;
  /**
   * The fee of the swap provider
   *
   * It is equal to the amount requested onchain minus the amount of the bolt11 invoice
   * Does not include the fee of the onchain transaction.
   */
  fee(): bigint | undefined;
  completePay(): Promise<boolean>;
}
/**
 * Wrapper over [`lwk_wollet::PricesFetcher`]
 */
export class PricesFetcher {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a new PricesFetcher with default settings
   */
  constructor();
  /**
   * Fetch exchange rates for the given currency (e.g., "USD", "EUR", "CHF")
   *
   * Returns an ExchangeRates object containing rates from multiple sources and the median
   */
  rates(currency: CurrencyCode): Promise<ExchangeRates>;
}
/**
 * Wrapper over [`lwk_wollet::PricesFetcherBuilder`]
 */
export class PricesFetcherBuilder {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
}
/**
 * Partially Signed Elements Transaction
 */
export class Pset {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates a `Pset` from its base64 string representation.
   */
  constructor(base64: string);
  /**
   * Return a base64 string representation of the Pset.
   * The string can be used to re-create the Pset via `new()`
   */
  toString(): string;
  /**
   * Extract the Transaction from a Pset by filling in
   * the available signature information in place.
   */
  extractTx(): Transaction;
  /**
   * Get the unique id of the PSET as defined by [BIP-370](https://github.com/bitcoin/bips/blob/master/bip-0370.mediawiki#unique-identification)
   *
   * The unique id is the txid of the PSET with sequence numbers of inputs set to 0
   */
  uniqueId(): Txid;
  /**
   * Attempt to merge with another `Pset`.
   */
  combine(other: Pset): void;
  /**
   * Return a copy of the inputs of this PSET
   */
  inputs(): PsetInput[];
  /**
   * Return a copy of the outputs of this PSET
   */
  outputs(): PsetOutput[];
  /**
   * Finalize and extract the PSET
   */
  finalize(): Transaction;
}
/**
 * The details regarding balance and amounts in a PSET:
 *
 * - The fee of the transaction in the PSET
 * - The net balance of the assets in the PSET from the point of view of the wallet
 * - The outputs going out of the wallet
 */
export class PsetBalance {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  fee(): bigint;
  /**
   * The net balance for every asset with respect of the wallet asking the pset details
   */
  balances(): Balance;
  recipients(): Recipient[];
}
/**
 * Builder for constructing a PSET from scratch
 */
export class PsetBuilder {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a new PSET v2 builder
   */
  static newV2(): PsetBuilder;
  /**
   * Add an input to this PSET
   */
  addInput(input: PsetInput): PsetBuilder;
  /**
   * Add an output to this PSET
   */
  addOutput(output: PsetOutput): PsetBuilder;
  /**
   * Set the fallback locktime on the PSET global tx_data
   */
  setFallbackLocktime(locktime: LockTime): PsetBuilder;
  /**
   * Blind the last output using the provided input secrets.
   *
   * `inp_txout_sec` is a map from input index to TxOutSecrets, represented as
   * parallel arrays where `input_indices[i]` corresponds to `secrets[i]`.
   */
  blindLast(input_indices: Uint32Array, secrets: TxOutSecrets[]): PsetBuilder;
  /**
   * Build the Pset, consuming the builder
   */
  build(): Pset;
}
/**
 * The details of a Partially Signed Elements Transaction:
 *
 * - the net balance from the point of view of the wallet
 * - the available and missing signatures for each input
 * - for issuances and reissuances transactions contains the issuance or reissuance details
 */
export class PsetDetails {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Return the balance of the PSET from the point of view of the wallet
   * that generated this via `psetDetails()`
   */
  balance(): PsetBalance;
  /**
   * For each input existing or missing signatures
   */
  signatures(): PsetSignatures[];
  /**
   * Set of fingerprints for which the PSET is missing a signature
   */
  fingerprintsMissing(): string[];
  /**
   * List of fingerprints for which the PSET has a signature
   */
  fingerprintsHas(): string[];
  /**
   * Return an element for every input that could possibly be a issuance or a reissuance
   */
  inputsIssuances(): Issuance[];
}
/**
 * PSET input
 */
export class PsetInput {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Prevout TXID of the input
   */
  previousTxid(): Txid;
  /**
   * Prevout vout of the input
   */
  previousVout(): number;
  /**
   * Prevout scriptpubkey of the input
   */
  previousScriptPubkey(): Script | undefined;
  /**
   * Redeem script of the input
   */
  redeemScript(): Script | undefined;
  /**
   * If the input has an issuance, the asset id
   */
  issuanceAsset(): AssetId | undefined;
  /**
   * If the input has an issuance, the token id
   */
  issuanceToken(): AssetId | undefined;
  /**
   * If the input has a (re)issuance, the issuance object
   */
  issuance(): Issuance | undefined;
  /**
   * Input sighash
   */
  sighash(): number;
  /**
   * If the input has an issuance, returns [asset_id, token_id].
   * Returns undefined if the input has no issuance.
   */
  issuanceIds(): AssetId[] | undefined;
}
/**
 * Builder for PSET inputs
 */
export class PsetInputBuilder {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Construct a PsetInputBuilder from an outpoint.
   */
  static fromPrevout(outpoint: OutPoint): PsetInputBuilder;
  /**
   * Set the witness UTXO.
   */
  witnessUtxo(utxo: TxOut): PsetInputBuilder;
  /**
   * Set the sequence number.
   */
  sequence(sequence: TxSequence): PsetInputBuilder;
  /**
   * Set the issuance value amount.
   */
  issuanceValueAmount(amount: bigint): PsetInputBuilder;
  /**
   * Set the issuance inflation keys.
   */
  issuanceInflationKeys(amount: bigint): PsetInputBuilder;
  /**
   * Set the issuance asset entropy.
   */
  issuanceAssetEntropy(contract_hash: ContractHash): PsetInputBuilder;
  /**
   * Set the blinded issuance flag.
   */
  blindedIssuance(flag: boolean): PsetInputBuilder;
  /**
   * Set the issuance blinding nonce.
   */
  issuanceBlindingNonce(nonce: Tweak): PsetInputBuilder;
  /**
   * Build the PsetInput, consuming the builder.
   */
  build(): PsetInput;
}
/**
 * PSET output
 */
export class PsetOutput {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Get the script pubkey
   */
  scriptPubkey(): Script;
  /**
   * Get the explicit amount, if set
   */
  amount(): bigint | undefined;
  /**
   * Get the explicit asset ID, if set
   */
  asset(): AssetId | undefined;
  /**
   * Get the blinder index, if set
   */
  blinderIndex(): number | undefined;
}
/**
 * Builder for PSET outputs
 */
export class PsetOutputBuilder {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Construct a PsetOutputBuilder with explicit asset and value.
   */
  static newExplicit(script_pubkey: Script, satoshi: bigint, asset: AssetId): PsetOutputBuilder;
  /**
   * Set the blinding public key.
   */
  blindingPubkey(blinding_key: PublicKey): PsetOutputBuilder;
  /**
   * Set the script pubkey.
   */
  scriptPubkey(script_pubkey: Script): PsetOutputBuilder;
  /**
   * Set the explicit amount.
   */
  satoshi(satoshi: bigint): PsetOutputBuilder;
  /**
   * Set the explicit asset ID.
   */
  asset(asset: AssetId): PsetOutputBuilder;
  /**
   * Set the blinder index.
   */
  blinderIndex(index: number): PsetOutputBuilder;
  /**
   * Build the PsetOutput, consuming the builder.
   */
  build(): PsetOutput;
}
/**
 * The details of the signatures in a PSET, divided in available and missing signatures.
 */
export class PsetSignatures {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Returns `Vec<(PublicKey, KeySource)>`
   */
  hasSignature(): any;
  missingSignature(): any;
}
/**
 * A Bitcoin ECDSA public key
 */
export class PublicKey {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates a `PublicKey` from a string.
   */
  static fromString(s: string): PublicKey;
  /**
   * Creates a `PublicKey` from a byte array (33 or 65 bytes)
   */
  static fromBytes(bytes: Uint8Array): PublicKey;
  /**
   * Derives a compressed `PublicKey` from a `SecretKey`
   */
  static fromSecretKey(sk: SecretKey): PublicKey;
  /**
   * Serializes the public key to bytes
   */
  toBytes(): Uint8Array;
  /**
   * Returns whether this public key is compressed (33 bytes) or uncompressed (65 bytes)
   */
  isCompressed(): boolean;
  /**
   * Converts to an x-only public key
   */
  toXOnlyPublicKey(): XOnlyPublicKey;
  /**
   * Returns the string representation.
   */
  toString(): string;
}
/**
 * Recipient of a PSET, in other words outputs that doesn't belong to the wallet
 */
export class Recipient {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  asset(): AssetId | undefined;
  value(): bigint | undefined;
  address(): Address | undefined;
  vout(): number;
}
/**
 * A Registry, a repository to store and retrieve asset metadata, like the name or the ticker of an asset.
 */
export class Registry {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a new registry cache specifying the URL of the registry,
   * fetch the assets metadata identified by the given asset ids and cache them for later local retrieval.
   * Use `default_for_network()` to get the default registry for the given network.
   */
  static new(url: string, asset_ids: AssetIds): Promise<Registry>;
  /**
   * Return the default registry for the given network,
   * fetch the assets metadata identified by the given asset ids and cache them for later local retrieval.
   * Use `new()` to specify a custom URL
   */
  static defaultForNetwork(network: Network, asset_ids: AssetIds): Promise<Registry>;
  /**
   * Create a new registry cache, using only the hardcoded assets.
   *
   * Hardcoded assets are the policy assets (LBTC, tLBTC, rLBTC) and the USDT asset on mainnet.
   */
  static defaultHardcodedForNetwork(network: Network): Registry;
  /**
   * Fetch the contract and the issuance transaction of the given asset id from the registry
   */
  fetchWithTx(asset_id: AssetId, client: EsploraClient): Promise<AssetMeta>;
  /**
   * Post a contract to the registry for registration.
   */
  post(data: RegistryPost): Promise<void>;
  /**
   * Return the asset metadata related to the given asset id if it exists in this registry.
   */
  get(asset_id: AssetId): RegistryData | undefined;
  /**
   * Return the asset metadata related to the given token id,
   * in other words `token_id` is the reissuance token of the returned asset
   */
  getAssetOfToken(token_id: AssetId): RegistryData | undefined;
  /**
   * Add the contracts information of the assets used in the Pset
   * if available in this registry.
   * Without the contract information, the partially signed transaction
   * is valid but will not show asset information when signed with an hardware wallet.
   */
  addContracts(pset: Pset): Pset;
}
export class RegistryData {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  precision(): number;
  ticker(): string;
  name(): string;
  domain(): string;
}
/**
 * The data to post to the registry to publish a contract for an asset id
 */
export class RegistryPost {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a new registry post object to be used to publish a contract for an asset id in the registry.
   */
  constructor(contract: Contract, asset_id: AssetId);
  /**
   * Return a string representation of the registry post (mostly for debugging).
   */
  toString(): string;
}
/**
 * An Elements (Liquid) script
 */
export class Script {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates a `Script` from its hex string representation.
   */
  constructor(s: string);
  /**
   * Creates an empty `Script`.
   */
  static empty(): Script;
  /**
   * Return the consensus encoded bytes of the script.
   */
  bytes(): Uint8Array;
  /**
   * Returns SHA256 of the script's consensus bytes.
   *
   * Returns an equivalent value to the `jet::input_script_hash(index)`/`jet::output_script_hash(index)`.
   */
  jet_sha256_hex(): string;
  /**
   * Return the string of the script showing op codes and their arguments.
   *
   * For example: "OP_DUP OP_HASH160 OP_PUSHBYTES_20 088ac47276d105b91cf9aa27a00112421dd5f23c OP_EQUALVERIFY OP_CHECKSIG"
   */
  asm(): string;
  /**
   * Creates an OP_RETURN script with the given data.
   */
  static newOpReturn(data: Uint8Array): Script;
  /**
   * Returns true if the script is provably unspendable.
   *
   * A script is provably unspendable if it starts with OP_RETURN or is larger
   * than the maximum script size.
   */
  isProvablyUnspendable(): boolean;
  /**
   * Returns true if this script_pubkey is provably SegWit.
   *
   * This checks if the script_pubkey is provably SegWit based on the
   * script_pubkey itself and an optional redeem_script.
   */
  isProvablySegwit(redeem_script?: Script | null): boolean;
  /**
   * Return the string representation of the script (hex encoding of its consensus encoded bytes).
   * This representation can be used to recreate the script via `new()`
   */
  toString(): string;
}
/**
 * A secret key
 */
export class SecretKey {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates a `SecretKey` from a 32-byte array
   */
  static fromBytes(bytes: Uint8Array): SecretKey;
  /**
   * Creates a `SecretKey` from a WIF (Wallet Import Format) string
   */
  static fromWif(wif: string): SecretKey;
  /**
   * Returns the bytes of the secret key (32 bytes)
   */
  to_bytes(): Uint8Array;
  /**
   * Sign the given `pset`
   */
  sign(pset: Pset): Pset;
}
/**
 * A Software signer.
 */
export class Signer {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates a `Signer`
   */
  constructor(mnemonic: Mnemonic, network: Network);
  /**
   * Sign and consume the given PSET, returning the signed one
   */
  sign(pset: Pset): Pset;
  /**
   * Sign a message with the master key, return the signature as a base64 string
   */
  signMessage(message: string): string;
  /**
   * Return the witness public key hash, slip77 descriptor of this signer
   */
  wpkhSlip77Descriptor(): WolletDescriptor;
  /**
   * Return the extended public key of the signer
   */
  getMasterXpub(): Xpub;
  /**
   * Return keyorigin and xpub, like "[73c5da0a/84h/1h/0h]tpub..."
   */
  keyoriginXpub(bip: Bip): string;
  /**
   * Return the signer fingerprint
   */
  fingerprint(): string;
  /**
   * Return the mnemonic of the signer
   */
  mnemonic(): Mnemonic;
  /**
   * Return the derived BIP85 mnemonic
   */
  derive_bip85_mnemonic(index: number, word_count: number): Mnemonic;
  /**
   * AMP0 signer data for login
   */
  amp0SignerData(): Amp0SignerData;
  /**
   * AMP0 sign login challenge
   */
  amp0SignChallenge(challenge: string): string;
  /**
   * AMP0 account xpub
   */
  amp0AccountXpub(account: number): string;
}
/**
 * Builder for Simplicity program arguments.
 */
export class SimplicityArguments {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a new empty arguments builder.
   */
  constructor();
  /**
   * Add a typed Simplicity value. Returns the builder with the value added.
   */
  addValue(name: string, value: SimplicityTypedValue): SimplicityArguments;
}
/**
 * A compiled Simplicity program ready for use in transactions.
 */
export class SimplicityProgram {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Load and compile a Simplicity program from source.
   */
  static load(source: string, _arguments: SimplicityArguments): SimplicityProgram;
  /**
   * Get the Commitment Merkle Root of the program.
   */
  cmr(): Cmr;
  /**
   * Create a P2TR address for this Simplicity program.
   */
  createP2trAddress(internal_key: XOnlyPublicKey, network: Network): Address;
  /**
   * Get the taproot control block for script-path spending.
   */
  controlBlock(internal_key: XOnlyPublicKey): ControlBlock;
  /**
   * Get the sighash_all message for signing a Simplicity program input.
   */
  getSighashAll(tx: Transaction, program_public_key: XOnlyPublicKey, utxos: TxOut[], input_index: number, network: Network): string;
  /**
   * Finalize a transaction with a Simplicity witness for the specified input.
   */
  finalizeTransaction(tx: Transaction, program_public_key: XOnlyPublicKey, utxos: TxOut[], input_index: number, witness_values: SimplicityWitnessValues, network: Network, log_level: SimplicityLogLevel): Transaction;
  /**
   * Create a Schnorr signature for a P2PK Simplicity program input.
   */
  createP2pkSignature(signer: Signer, derivation_path: string, tx: Transaction, utxos: TxOut[], input_index: number, network: Network): string;
  /**
   * Satisfy and execute this program in a transaction environment.
   */
  run(tx: Transaction, program_public_key: XOnlyPublicKey, utxos: TxOut[], input_index: number, witness_values: SimplicityWitnessValues, network: Network, log_level: SimplicityLogLevel): SimplicityRunResult;
}
/**
 * The result of running a Simplicity program.
 */
export class SimplicityRunResult {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Get the serialized program bytes.
   */
  programBytes(): Uint8Array;
  /**
   * Get the serialized witness bytes.
   */
  witnessBytes(): Uint8Array;
  /**
   * Get the Commitment Merkle Root of the pruned program.
   * TODO: CMR wrapper type should be returned instead (same for the lwk_bindings)
   */
  cmr(): Uint8Array;
  /**
   * Get the resulting value as a string representation.
   */
  value(): string;
}
/**
 * Simplicity type descriptor.
 */
export class SimplicityType {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create the `u1` type.
   */
  static u1(): SimplicityType;
  /**
   * Create the `u8` type.
   */
  static u8(): SimplicityType;
  /**
   * Create the `u16` type.
   */
  static u16(): SimplicityType;
  /**
   * Create the `u32` type.
   */
  static u32(): SimplicityType;
  /**
   * Create the `u64` type.
   */
  static u64(): SimplicityType;
  /**
   * Create the `u128` type.
   */
  static u128(): SimplicityType;
  /**
   * Create the `u256` type.
   */
  static u256(): SimplicityType;
  /**
   * Create the `bool` type.
   */
  static boolean(): SimplicityType;
  /**
   * Create an `Either<left, right>` type.
   */
  static either(left: SimplicityType, right: SimplicityType): SimplicityType;
  /**
   * Create an `Option<inner>` type.
   */
  static option(inner: SimplicityType): SimplicityType;
  /**
   * Create a tuple type from elements.
   */
  static fromElements(elements: SimplicityType[]): SimplicityType;
  /**
   * Parse a type from a string.
   */
  constructor(type_str: string);
}
/**
 * Typed Simplicity value.
 */
export class SimplicityTypedValue {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a `u8` value.
   */
  static fromU8(value: number): SimplicityTypedValue;
  /**
   * Create a `u16` value.
   */
  static fromU16(value: number): SimplicityTypedValue;
  /**
   * Create a `u32` value.
   */
  static fromU32(value: number): SimplicityTypedValue;
  /**
   * Create a `u64` value.
   */
  static fromU64(value: bigint): SimplicityTypedValue;
  /**
   * Create a `u128` value from hex (32 hex characters = 16 bytes).
   */
  static fromU128Hex(hex: string): SimplicityTypedValue;
  /**
   * Create a `u256` value from hex (64 hex characters = 32 bytes).
   */
  static fromU256Hex(hex: string): SimplicityTypedValue;
  /**
   * Create a `bool` value.
   */
  static fromBoolean(value: boolean): SimplicityTypedValue;
  /**
   * Create a `Left` value.
   */
  static left(value: SimplicityTypedValue, right_type: SimplicityType): SimplicityTypedValue;
  /**
   * Create a `Right` value.
   */
  static right(left_type: SimplicityType, value: SimplicityTypedValue): SimplicityTypedValue;
  /**
   * Create a tuple value from elements.
   */
  static fromElements(elements: SimplicityTypedValue[]): SimplicityTypedValue;
  /**
   * Create a `None` value.
   */
  static none(inner_type: SimplicityType): SimplicityTypedValue;
  /**
   * Create a `Some` value.
   */
  static some(value: SimplicityTypedValue): SimplicityTypedValue;
  /**
   * Create a byte array value from hex.
   */
  static fromByteArrayHex(hex: string): SimplicityTypedValue;
  /**
   * Parse a value from a string with a given type.
   */
  constructor(value_str: string, ty: SimplicityType);
}
/**
 * Builder for Simplicity witness values.
 */
export class SimplicityWitnessValues {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a new empty witness values builder.
   */
  constructor();
  /**
   * Add a typed Simplicity value. Returns the builder with the value added.
   */
  addValue(name: string, value: SimplicityTypedValue): SimplicityWitnessValues;
}
export class Singlesig {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  static from(variant: string): Singlesig;
}
/**
 * Taproot builder for Simplicity-related functionality.
 *
 * This builder is tailored for state-management trees that combine a Simplicity
 * leaf with hidden TapData leaves, but it can also be used for generic trees.
 */
export class StateTaprootBuilder {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a new builder.
   */
  constructor();
  /**
   * Add a Simplicity leaf at `depth`.
   */
  addSimplicityLeaf(depth: number, cmr: Cmr): StateTaprootBuilder;
  /**
   * Add a TapData hidden leaf at `depth`.
   */
  addDataLeaf(depth: number, data: Uint8Array): StateTaprootBuilder;
  /**
   * Add a precomputed hidden hash at `depth`.
   */
  addHiddenHash(depth: number, hash: Uint8Array): StateTaprootBuilder;
  /**
   * Finalize and produce Taproot spend info.
   */
  finalize(internal_key: XOnlyPublicKey): StateTaprootSpendInfo;
}
/**
 * Taproot spending information.
 */
export class StateTaprootSpendInfo {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Get the tweaked Taproot output key.
   */
  outputKey(): XOnlyPublicKey;
  /**
   * Get output key parity (0 for even, 1 for odd).
   */
  outputKeyParity(): number;
  /**
   * Get the internal key.
   */
  internalKey(): XOnlyPublicKey;
  /**
   * Get the Taproot script tree merkle root bytes, if present.
   */
  merkleRoot(): Uint8Array | undefined;
  /**
   * Get the control block for a script identified by CMR.
   */
  controlBlock(cmr: Cmr): ControlBlock;
  /**
   * Get script pubkey as v1 P2TR output script for the tweaked output key.
   */
  scriptPubkey(): Script;
}
/**
 * Blockchain tip, the highest valid block in the blockchain
 */
export class Tip {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  height(): number;
  hash(): string;
  timestamp(): number | undefined;
}
/**
 * A Liquid transaction
 *
 * See `WalletTx` for the transaction as seen from the perspective of the wallet
 * where you can actually see unblinded amounts and tx net-balance.
 */
export class Transaction {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates a `Transaction`
   *
   * Deprecated: use `fromString()` instead.
   */
  constructor(tx_hex: string);
  /**
   * Creates a `Transaction` from hex-encoded consensus bytes.
   */
  static fromString(s: string): Transaction;
  /**
   * Creates a `Transaction` from consensus-encoded bytes.
   */
  static fromBytes(bytes: Uint8Array): Transaction;
  /**
   * Return the transaction identifier.
   */
  txid(): Txid;
  /**
   * Return the consensus encoded bytes of the transaction.
   */
  toBytes(): Uint8Array;
  /**
   * Return the consensus encoded bytes of the transaction.
   *
   * Deprecated: use `toBytes()` instead.
   */
  bytes(): Uint8Array;
  /**
   * Return the fee of the transaction in the given asset.
   * At the moment the only asset that can be used as fee is the policy asset (LBTC for mainnet).
   */
  fee(policy_asset: AssetId): bigint;
  /**
   * Return the hex representation of the transaction. More precisely, they are the consensus encoded bytes of the transaction converted in hex.
   */
  toString(): string;
  /**
   * Return a clone of the inputs of this transaction
   */
  inputs(): TxIn[];
  /**
   * Return a clone of the outputs of this transaction
   */
  outputs(): TxOut[];
}
/**
 * Editor for modifying transactions.
 */
export class TransactionEditor {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create an editor from an existing transaction.
   */
  static fromTransaction(tx: Transaction): TransactionEditor;
  /**
   * Set the witness for a specific input.
   */
  setInputWitness(input_index: number, witness: TxInWitness): TransactionEditor;
  /**
   * Build the transaction, consuming the editor.
   */
  build(): Transaction;
}
/**
 * Represents a blinding factor/Tweak on secp256k1 curve.
 */
export class Tweak {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a Tweak from a 32-byte slice.
   */
  static fromBytes(bytes: Uint8Array): Tweak;
  /**
   * Create a Tweak from a string.
   */
  static fromString(s: string): Tweak;
  /**
   * Create the zero tweak.
   */
  static zero(): Tweak;
  /**
   * Return the bytes of the tweak (32 bytes).
   */
  toBytes(): Uint8Array;
  /**
   * Returns the string representation.
   */
  toString(): string;
}
/**
 * A transaction builder
 */
export class TxBuilder {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates a transaction builder
   */
  constructor(network: Network);
  /**
   * Build the transaction
   */
  finish(wollet: Wollet): Pset;
  /**
   * Build the transaction for AMP0
   */
  finishForAmp0(wollet: Wollet): Amp0Pset;
  /**
   * Set the fee rate
   */
  feeRate(fee_rate?: number | null): TxBuilder;
  /**
   * Select all available L-BTC inputs
   */
  drainLbtcWallet(): TxBuilder;
  /**
   * Sets the address to drain excess L-BTC to
   */
  drainLbtcTo(address: Address): TxBuilder;
  /**
   * Add a recipient receiving L-BTC
   *
   * Errors if address's network is incompatible
   */
  addLbtcRecipient(address: Address, satoshi: bigint): TxBuilder;
  /**
   * Add a recipient receiving the given asset
   *
   * Errors if address's network is incompatible
   */
  addRecipient(address: Address, satoshi: bigint, asset: AssetId): TxBuilder;
  /**
   * Burn satoshi units of the given asset
   */
  addBurn(satoshi: bigint, asset: AssetId): TxBuilder;
  /**
   * Add explicit recipient
   */
  addExplicitRecipient(address: Address, satoshi: bigint, asset: AssetId): TxBuilder;
  /**
   * Issue an asset
   *
   * There will be `asset_sats` units of this asset that will be received by
   * `asset_receiver` if it's set, otherwise to an address of the wallet generating the issuance.
   *
   * There will be `token_sats` reissuance tokens that allow token holder to reissue the created
   * asset. Reissuance token will be received by `token_receiver` if it's some, or to an
   * address of the wallet generating the issuance if none.
   *
   * If a `contract` is provided, it's metadata will be committed in the generated asset id.
   *
   * Can't be used if `reissue_asset` has been called
   */
  issueAsset(asset_sats: bigint, asset_receiver: Address | null | undefined, token_sats: bigint, token_receiver?: Address | null, contract?: Contract | null): TxBuilder;
  /**
   * Reissue an asset
   *
   * reissue the asset defined by `asset_to_reissue`, provided the reissuance token is owned
   * by the wallet generating te reissuance.
   *
   * Generated transaction will create `satoshi_to_reissue` new asset units, and they will be
   * sent to the provided `asset_receiver` address if some, or to an address from the wallet
   * generating the reissuance transaction if none.
   *
   * If the issuance transaction does not involve this wallet,
   * pass the issuance transaction in `issuance_tx`.
   */
  reissueAsset(asset_to_reissue: AssetId, satoshi_to_reissue: bigint, asset_receiver?: Address | null, issuance_tx?: Transaction | null): TxBuilder;
  /**
   * Switch to manual coin selection by giving a list of internal UTXOs to use.
   *
   * All passed UTXOs are added to the transaction.
   * No other wallet UTXO is added to the transaction, caller is supposed to add enough UTXOs to
   * cover for all recipients and fees.
   *
   * This method never fails, any error will be raised in [`TxBuilder::finish`].
   *
   * Possible errors:
   * * OutPoint doesn't belong to the wallet
   * * Insufficient funds (remember to include L-BTC utxos for fees)
   */
  setWalletUtxos(outpoints: OutPoint[]): TxBuilder;
  /**
   * Return a string representation of the transaction builder (mostly for debugging)
   */
  toString(): string;
  /**
   * Set data to create a PSET from which you
   * can create a LiquiDEX proposal
   */
  liquidexMake(utxo: OutPoint, address: Address, satoshi: bigint, asset_id: AssetId): TxBuilder;
  /**
   * Set data to take LiquiDEX proposals
   */
  liquidexTake(proposals: ValidatedLiquidexProposal[]): TxBuilder;
  /**
   * Add input rangeproofs
   */
  addInputRangeproofs(add_rangeproofs: boolean): TxBuilder;
}
/**
 * A transaction input.
 */
export class TxIn {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Get the outpoint (previous output) for this input.
   */
  outpoint(): OutPoint;
  /**
   * Get the witness for this input.
   */
  witness(): TxInWitness;
  /**
   * Get the sequence number for this input.
   */
  sequence(): TxSequence;
}
/**
 * A transaction input witness.
 */
export class TxInWitness {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create an empty witness.
   */
  static empty(): TxInWitness;
  /**
   * Create a witness from script witness elements.
   *
   * Takes an array of hex strings representing the witness stack.
   */
  static fromScriptWitness(script_witness: string[]): TxInWitness;
  /**
   * Get the script witness elements.
   *
   * Returns an array of hex strings.
   */
  scriptWitness(): string[];
  /**
   * Get the peg-in witness elements.
   *
   * Returns an array of hex strings.
   */
  peginWitness(): string[];
  /**
   * Check if the witness is empty.
   */
  isEmpty(): boolean;
}
/**
 * Builder for creating a TxInWitness.
 */
export class TxInWitnessBuilder {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a new witness builder.
   */
  constructor();
  /**
   * Set the script witness elements.
   *
   * Takes an array of hex strings representing the witness stack.
   */
  scriptWitness(witness: string[]): TxInWitnessBuilder;
  /**
   * Set the peg-in witness elements.
   *
   * Takes an array of hex strings representing the peg-in witness stack.
   */
  peginWitness(witness: string[]): TxInWitnessBuilder;
  /**
   * Set the amount rangeproof from serialized bytes.
   */
  amountRangeproof(proof: Uint8Array): TxInWitnessBuilder;
  /**
   * Set the inflation keys rangeproof from serialized bytes.
   */
  inflationKeysRangeproof(proof: Uint8Array): TxInWitnessBuilder;
  /**
   * Build the TxInWitness.
   */
  build(): TxInWitness;
}
/**
 * A transaction output
 */
export class TxOut {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a TxOut with explicit asset and value from script pubkey and asset ID.
   *
   * This is useful for constructing UTXOs for Simplicity transaction signing.
   */
  static fromExplicit(script_pubkey: Script, asset_id: AssetId, satoshi: bigint): TxOut;
  /**
   * Get the scriptpubkey
   */
  scriptPubkey(): Script;
  /**
   * Whether or not this output is a fee output
   */
  isFee(): boolean;
  /**
   * Returns if at least some part of this output is blinded
   */
  isPartiallyBlinded(): boolean;
  /**
   * If explicit returns the asset, if confidential returns undefined
   */
  asset(): AssetId | undefined;
  /**
   * If explicit returns the value, if confidential returns undefined
   */
  value(): bigint | undefined;
  /**
   * Get the unconfidential address for this output
   */
  unconfidentialAddress(network: Network): Address | undefined;
  /**
   * Unblind the output using the given secret key
   */
  unblind(secret_key: SecretKey): TxOutSecrets;
}
/**
 * Contains unblinded information such as the asset and the value of a transaction output
 */
export class TxOutSecrets {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates a new `TxOutSecrets` with the given asset, blinding factors, and value.
   */
  constructor(asset_id: AssetId, asset_bf: AssetBlindingFactor, value: bigint, value_bf: ValueBlindingFactor);
  /**
   * Creates a new `TxOutSecrets` for an explicit (unblinded) output.
   *
   * The blinding factors are set to zero.
   */
  static fromExplicit(asset_id: AssetId, value: bigint): TxOutSecrets;
  /**
   * Return the asset of the output.
   */
  asset(): AssetId;
  /**
   * Return the asset blinding factor as a hex string.
   */
  assetBlindingFactor(): string;
  /**
   * Return the value of the output.
   */
  value(): bigint;
  /**
   * Return the value blinding factor as a hex string.
   */
  valueBlindingFactor(): string;
  /**
   * Return true if the output is explicit (no blinding factors).
   */
  isExplicit(): boolean;
  /**
   * Get the asset commitment
   *
   * If the output is explicit, returns the empty string
   */
  assetCommitment(): string;
  /**
   * Get the value commitment
   *
   * If the output is explicit, returns the empty string
   */
  valueCommitment(): string;
  /**
   * Return the asset blinding factor as a typed object.
   */
  assetBlindingFactorTyped(): AssetBlindingFactor;
  /**
   * Return the value blinding factor as a typed object.
   */
  valueBlindingFactorTyped(): ValueBlindingFactor;
}
/**
 * Transaction input sequence number.
 */
export class TxSequence {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a sequence from a u32 value.
   */
  constructor(value: number);
  /**
   * Zero value sequence.
   *
   * This sequence number enables replace-by-fee and lock-time.
   */
  static zero(): TxSequence;
  /**
   * The maximum allowable sequence number.
   *
   * This sequence number disables lock-time and replace-by-fee.
   */
  static max(): TxSequence;
  /**
   * The sequence number that enables replace-by-fee and absolute lock-time but
   * disables relative lock-time.
   */
  static enableRbfNoLocktime(): TxSequence;
  /**
   * The sequence number that enables absolute lock-time but disables replace-by-fee
   * and relative lock-time.
   */
  static enableLocktimeNoRbf(): TxSequence;
  /**
   * Create a relative lock-time using block height.
   */
  static fromHeight(height: number): TxSequence;
  /**
   * Create a relative lock-time using time intervals where each interval is equivalent
   * to 512 seconds.
   */
  static from512SecondIntervals(intervals: number): TxSequence;
  /**
   * Create a relative lock-time from seconds, converting the seconds into 512 second
   * interval with floor division.
   */
  static fromSecondsFloor(seconds: number): TxSequence;
  /**
   * Create a relative lock-time from seconds, converting the seconds into 512 second
   * interval with ceiling division.
   */
  static fromSecondsCeil(seconds: number): TxSequence;
  /**
   * Returns the inner 32bit integer value of Sequence.
   */
  toConsensusU32(): number;
  /**
   * Returns `true` if the sequence number indicates that the transaction is finalised.
   */
  isFinal(): boolean;
  /**
   * Returns true if the transaction opted-in to BIP125 replace-by-fee.
   */
  isRbf(): boolean;
  /**
   * Returns `true` if the sequence has a relative lock-time.
   */
  isRelativeLockTime(): boolean;
  /**
   * Returns `true` if the sequence number encodes a block based relative lock-time.
   */
  isHeightLocked(): boolean;
  /**
   * Returns `true` if the sequene number encodes a time interval based relative lock-time.
   */
  isTimeLocked(): boolean;
  /**
   * Returns `true` if the sequence number enables absolute lock-time.
   */
  enablesAbsoluteLockTime(): boolean;
}
/**
 * A valid transaction identifier.
 *
 * 32 bytes encoded as hex string.
 */
export class Txid {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates a `Txid` from its hex string representation (64 characters).
   */
  constructor(tx_id: string);
  /**
   * Return the string representation of the transaction identifier as shown in the explorer.
   * This representation can be used to recreate the transaction identifier via `new()`
   */
  toString(): string;
}
/**
 * LiquiDEX swap proposal
 *
 * A LiquiDEX swap proposal is a transaction with one input and one output created by the "maker".
 * The transaction "swaps" the input for the output, meaning that the "maker" sends the input and
 * receives the output.
 * However the transaction is incomplete (unbalanced and without a fee output), thus it cannot be
 * broadcast.
 * The "taker" can "complete" the transaction (using [`crate::TxBuilder::liquidex_take()`]) by
 * adding more inputs and more outputs to balance the amounts, meaning that the "taker" sends the
 * output and receives the input.
 */
export class UnvalidatedLiquidexProposal {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  static new(s: string): UnvalidatedLiquidexProposal;
  static fromPset(pset: Pset): UnvalidatedLiquidexProposal;
  insecureValidate(): ValidatedLiquidexProposal;
  validate(tx: Transaction): ValidatedLiquidexProposal;
  toString(): string;
}
/**
 * An Update contains the delta of information to be applied to the wallet to reach the latest status.
 * It's created passing a reference to the wallet to the blockchain client
 */
export class Update {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates an `Update`
   */
  constructor(bytes: Uint8Array);
  /**
   * Serialize an update to a byte array
   */
  serialize(): Uint8Array;
  /**
   * Serialize an update to a base64 encoded string,
   * encrypted with a key derived from the descriptor.
   * Decrypt using `deserialize_decrypted_base64()`
   */
  serializeEncryptedBase64(desc: WolletDescriptor): string;
  /**
   * Deserialize an update from a base64 encoded string,
   * decrypted with a key derived from the descriptor.
   * Create the base64 using `serialize_encrypted_base64()`
   */
  static deserializeDecryptedBase64(base64: string, desc: WolletDescriptor): Update;
  /**
   * Whether this update only changes the tip
   */
  onlyTip(): boolean;
  /**
   * Prune the update, removing unneeded data from transactions.
   */
  prune(wollet: Wollet): void;
}
/**
 * Created by validating `UnvalidatedLiquidexProposal` via `validate()` or `insecure_validate()`
 */
export class ValidatedLiquidexProposal {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  input(): AssetAmount;
  output(): AssetAmount;
  toString(): string;
}
/**
 * A blinding factor for value commitments.
 */
export class ValueBlindingFactor {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates a `ValueBlindingFactor` from a string.
   */
  static fromString(s: string): ValueBlindingFactor;
  /**
   * Creates a `ValueBlindingFactor` from a byte slice.
   */
  static fromBytes(bytes: Uint8Array): ValueBlindingFactor;
  /**
   * Returns a zero value blinding factor.
   */
  static zero(): ValueBlindingFactor;
  /**
   * Returns the bytes (32 bytes) in little-endian byte order.
   *
   * This is the internal representation used by secp256k1. The byte order is
   * reversed compared to the hex string representation (which uses big-endian,
   * following Bitcoin display conventions).
   */
  toBytes(): Uint8Array;
  /**
   * Returns string representation of the VBF
   */
  toString(): string;
}
/**
 * Value returned by asking transactions to the wallet. Contains details about a transaction
 * from the perspective of the wallet, for example the net-balance of the transaction for the
 * wallet.
 */
export class WalletTx {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Return a copy of the transaction.
   */
  tx(): Transaction;
  /**
   * Return the height of the block containing the transaction if it's confirmed.
   */
  height(): number | undefined;
  /**
   * Return the net balance of the transaction for the wallet.
   */
  balance(): Balance;
  /**
   * Return the transaction identifier.
   */
  txid(): Txid;
  /**
   * Return the fee of the transaction.
   */
  fee(): bigint;
  /**
   * Return the type of the transaction. Can be "issuance", "reissuance", "burn", "redeposit", "incoming", "outgoing" or "unknown".
   */
  txType(): string;
  /**
   * Return the timestamp of the block containing the transaction if it's confirmed.
   */
  timestamp(): number | undefined;
  /**
   * Return a list with the same number of elements as the inputs of the transaction.
   * The element in the list is a `WalletTxOut` (the output spent to create the input)
   * if it belongs to the wallet, while it is None for inputs owned by others
   */
  inputs(): OptionWalletTxOut[];
  /**
   * Return a list with the same number of elements as the outputs of the transaction.
   * The element in the list is a `WalletTxOut` if it belongs to the wallet,
   * while it is None for inputs owned by others
   */
  outputs(): OptionWalletTxOut[];
  /**
   * Return the URL to the transaction on the given explorer including the information
   * needed to unblind the transaction in the explorer UI.
   */
  unblindedUrl(explorer_url: string): string;
}
/**
 * Details of a wallet transaction output used in `WalletTx`
 */
export class WalletTxOut {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Return the outpoint (txid and vout) of this `WalletTxOut`.
   */
  outpoint(): OutPoint;
  /**
   * Return the script pubkey of the address of this `WalletTxOut`.
   */
  scriptPubkey(): Script;
  /**
   * Return the height of the block containing this output if it's confirmed.
   */
  height(): number | undefined;
  /**
   * Return the unblinded values of this `WalletTxOut`.
   */
  unblinded(): TxOutSecrets;
  /**
   * Return the wildcard index used to derive the address of this `WalletTxOut`.
   */
  wildcardIndex(): number;
  /**
   * Return the chain of this `WalletTxOut`. Can be "Chain::External" or "Chain::Internal" (change).
   */
  extInt(): Chain;
  /**
   * Return the address of this `WalletTxOut`.
   */
  address(): Address;
}
/**
 * A watch-only wallet defined by a CT descriptor.
 */
export class Wollet {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Create a `Wollet`
   */
  constructor(network: Network, descriptor: WolletDescriptor);
  /**
   * Get a wallet address with the correspondong derivation index
   *
   * If Some return the address at the given index,
   * otherwise the last unused address.
   */
  address(index?: number | null): AddressResult;
  /**
   * Return the [ELIP152](https://github.com/ElementsProject/ELIPs/blob/main/elip-0152.mediawiki) deterministic wallet identifier.
   */
  dwid(): string;
  /**
   * Get the full derivation path for an address
   *
   * Note: will be removed once we add the full path to lwk_wollet::AddressResult
   */
  addressFullPath(index: number): Uint32Array;
  /**
   * Apply an update containing blockchain data
   *
   * To update the wallet you need to first obtain the blockchain data relevant for the wallet.
   * This can be done using a `full_scan()`, which
   * returns an `Update` that contains new transaction and other data relevant for the
   * wallet.
   * The update must then be applied to the `Wollet` so that wollet methods such as
   * `balance()` or `transactions()` include the new data.
   *
   * However getting blockchain data involves network calls, so between the full scan start and
   * when the update is applied it might elapse a significant amount of time.
   * In that interval, applying any update, or any transaction using `apply_transaction()`,
   * will cause this function to return a `Error::UpdateOnDifferentStatus`.
   * Callers should either avoid applying updates and transactions, or they can catch the error
   * and wait for a new full scan to be completed and applied.
   */
  applyUpdate(update: Update): void;
  /**
   * Apply a transaction to the wallet state
   *
   * Wallet transactions are normally obtained using a `full_scan()`
   * and applying the result with `apply_update()`. However a
   * full scan involves network calls and it can take a significant amount of time.
   *
   * If the caller does not want to wait for a full scan containing the transaction, it can
   * apply the transaction to the wallet state using this function.
   *
   * Note: if this transaction is *not* returned by a next full scan, after `apply_update()` it will disappear from the
   * transactions list, will not be included in balance computations, and by the remaining
   * wollet methods.
   *
   * Calling this method, might cause `apply_update()` to fail with a
   * `Error::UpdateOnDifferentStatus`, make sure to either avoid it or handle the error properly.
   */
  applyTransaction(tx: Transaction): Balance;
  /**
   * Get the wallet balance for each assets
   */
  balance(): Balance;
  /**
   * Get the asset identifiers owned by the wallet
   */
  assetsOwned(): AssetIds;
  /**
   * Get the wallet transactions
   */
  transactions(): WalletTx[];
  /**
   * Get the unspent transaction outputs of the wallet
   */
  utxos(): WalletTxOut[];
  /**
   * Get all the transaction outputs of the wallet, both spent and unspent
   */
  txos(): WalletTxOut[];
  /**
   * Finalize and consume the given PSET, returning the finalized one
   */
  finalize(pset: Pset): Pset;
  /**
   * Get the PSET details with respect to the wallet
   */
  psetDetails(pset: Pset): PsetDetails;
  /**
   * Get a copy of the wallet descriptor of this wallet.
   */
  descriptor(): WolletDescriptor;
  /**
   * A deterministic value derived from the descriptor, the config and the content of this wollet,
   * including what's in the wallet store (transactions etc)
   *
   * In this case, we don't need cryptographic assurance guaranteed by the std default hasher (siphash)
   * And we can use a much faster hasher, which is used also in the rust compiler.
   * ([source](https://nnethercote.github.io/2021/12/08/a-brutally-effective-hash-function-in-rust.html))
   */
  status(): bigint;
  /**
   * Get the blockchain tip at the time of the last update of this wollet.
   */
  tip(): Tip;
  /**
   * Returns true if this wollet has never received an updated applyed to it
   */
  neverScanned(): boolean;
  /**
   * Whether the wallet is AMP0
   */
  isAmp0(): boolean;
}
/**
 * A wrapper that contains only the subset of CT descriptors handled by wollet
 */
export class WolletDescriptor {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates a `WolletDescriptor`
   */
  constructor(descriptor: string);
  /**
   * Return the string representation of the descriptor, including the checksum.
   * This representation can be used to recreate the descriptor via `new()`
   */
  toString(): string;
  /**
   * Create a new multisig descriptor, where each participant is a keyorigin_xpub and it requires at least threshold signatures to spend.
   * Errors if the threshold is 0 or greater than the number of participants.
   * Uses slip77 for the blinding key.
   */
  static newMultiWshSlip77(threshold: number, participants: string[]): WolletDescriptor;
  /**
   * Whether the descriptor is for mainnet
   */
  isMainnet(): boolean;
  /**
   * Whether the descriptor is AMP0
   */
  isAmp0(): boolean;
}
/**
 * An x-only public key, used for verification of Taproot signatures and serialized according to BIP-340.
 */
export class XOnlyPublicKey {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates an `XOnlyPublicKey` from a string.
   */
  static fromString(s: string): XOnlyPublicKey;
  /**
   * Creates an `XOnlyPublicKey` from raw bytes (32 bytes).
   */
  static fromBytes(bytes: Uint8Array): XOnlyPublicKey;
  /**
   * Serializes the x-only public key to bytes (32 bytes).
   */
  toBytes(): Uint8Array;
  /**
   * Returns the string representation.
   */
  toString(): string;
}
/**
 * An extended public key
 */
export class Xpub {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Creates a Xpub
   */
  constructor(s: string);
  /**
   * Return the string representation of the Xpub.
   * This representation can be used to recreate the Xpub via `new()`
   */
  toString(): string;
  /**
   * Return the identifier of the Xpub.
   * This is a 40 hex characters string (20 bytes).
   */
  identifier(): string;
  /**
   * Return the first four bytes of the identifier as hex string
   * This is a 8 hex characters string (4 bytes).
   */
  fingerprint(): string;
  /**
   * Returns true if the passed string is a valid xpub with a valid keyorigin if present.
   * For example: "[73c5da0a/84h/1h/0h]tpub..."
   */
  static isValidWithKeyOrigin(s: string): boolean;
}
