# Wallet ABI SDK Alpha

Browser-first Wallet ABI SDK for frontend apps integrating with the
`lwk_simplicity` Wallet ABI over WalletConnect.

## Surface

- `WalletAbiClient` for the 3 supported Wallet ABI RPC methods
- `protocol` helpers for Wallet ABI JSON-RPC envelopes
- `schema` types aligned to the Rust wire contract
- `builders` for request construction
- `helpers` for lazy `lwk_wasm` browser helpers
- `wallet` bridge types for wallet/provider implementations
- `walletconnect` helpers for namespace, chain, and requester wiring
- `vendor` for direct `lwk_wasm` re-exports when low-level access is needed

## Example

```ts
import {
  WalletAbiClient,
  createWalletConnectRequester,
  walletAbiNetworkToWalletConnectChain,
} from "wallet-abi-sdk-alpha";

const requester = createWalletConnectRequester({
  chainId: walletAbiNetworkToWalletConnectChain("testnet-liquid"),
  client: {
    async request({ chainId, topic, request }) {
      return await universalProvider.request({
        chainId,
        topic,
        request,
      });
    },
  },
});

const client = new WalletAbiClient({
  requester,
});

await client.connect();
const receiveAddress = await client.getSignerReceiveAddress();
const pubkey = await client.getRawSigningXOnlyPubkey();
```
