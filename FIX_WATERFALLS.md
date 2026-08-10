# Waterfalls utxo_only fix — how to test it locally

Fork: https://github.com/lilbonekit/waterfalls/tree/fix/utxo-only-history-cap
(PR: https://github.com/lilbonekit/waterfalls/pull/new/fix/utxo-only-history-cap)

**The bug:** `utxo_only=true` used to cap a script's raw history _before_
filtering out spent outputs. So a reused address with more than 100 total
transactions would 400 with `UtxoOnlyHistoryTooLarge` even if almost all of
that history was already spent and only a few outputs were still live.

**The fix:** filter first, then cap on how many outputs are actually still
unspent. Same protection against a genuinely huge live UTXO set, it just
measures the right thing now.

**Once this lands on the waterfalls server we actually deploy against:**
`utxoOnly` can go back to `true` for real (not just for this test) in
`web/src/lwk/index.ts`, and the whole IndexedDB persistent-cache workaround in
`web/src/lib/wallet-core/store/walletCache.ts` can be ripped out — it only
exists to make non-`utxo_only` scans (full history, slow first sync) bearable.
With `utxo_only` working, scans go back to being fast and small without it.

Every command block below sources `/tmp/wf-env.sh` first. That file gets
built up step by step as you go — each step appends the variable(s) it just
figured out, so any block you paste has everything discovered before it.
Never re-derive anything by hand.

## Run it

That's it, two steps:

1. **Open a new terminal.**

   Kill any orphaned `elementsd` from a previous attempt first (safe — this
   only matches processes that got detached from their parent, never a
   process anything currently depends on):

   ```bash
   ps -eo pid,ppid,command | awk '$2==1 && /elementsd/ {print $1}' | xargs -r kill
   ```

   `elementsd` is the Elements Core node — it's what actually runs the local
   regtest chain the patched server indexes and that you'll send test
   transactions to. Check if you already have it:

   ```bash
   which elementsd
   ```

   If you've installed the `simplex` toolchain (see the indexer setup doc)
   it's already on your PATH from there. Otherwise grab a binary from
   https://github.com/ElementsProject/elements/releases.

   Install it somewhere convenient — anywhere works, this doc just assumes
   `~/waterfalls` below. **Skip this if you already have it cloned:**

   ```bash
   git clone https://github.com/lilbonekit/waterfalls ~/waterfalls
   ```

   Then, every time:

   ```bash
   cd ~/waterfalls
   git checkout fix/utxo-only-history-cap
   git pull
   ELEMENTSD_EXEC="$(which elementsd)" \
     cargo test --features test_env manual_persistent_server -- --ignored --nocapture --test-threads=1 \
     2>&1 | tee /tmp/waterfalls-manual.log
   ```

   ✅ Once you see `Starting on http://127.0.0.1:...` in the output, it's up
   and running in the foreground.

   > ⚠️ After that it prints nothing else, ever — it just sits there. **That
   > looks frozen but isn't — don't press Ctrl+C.** Killing it (even by
   > accident) also orphans the `elementsd` it started, which is exactly
   > what the cleanup command above is for next time.

   **Stay in this terminal — don't touch it again.** Everything else in this
   doc happens elsewhere.

   **Open a new terminal.** This wipes any leftover `/tmp/wf-env.sh` from a
   previous run and creates a fresh one:

   ```bash
   rm -f /tmp/wf-env.sh
   PORT=$(grep -oE 'WATERFALLS_BASE_URL=http://127.0.0.1:[0-9]+' /tmp/waterfalls-manual.log | tail -1 | grep -oE '[0-9]+$')
   echo "export PORT='$PORT'" > /tmp/wf-env.sh
   echo "PORT=$PORT"
   ```

   That last line should print an actual number. If it prints `PORT=`
   (empty), the log doesn't have that line yet or the path is wrong — check
   `/tmp/waterfalls-manual.log` by hand.

   > ⚠️ The port is random every run. If you restart the server, re-run this
   > block too (it wipes and rebuilds `/tmp/wf-env.sh`, so everything
   > downstream needs re-deriving after — the appendix's `ADDR`/`DESC`
   > steps included).

2. Point the web app at it and turn `utxo_only` on. In `web/.env.local`
   (gitignored):

   ```
   VITE_NETWORK=regtest
   VITE_WATERFALLS_URL=http://127.0.0.1:PORT   # the number from step 1, typed literally — this file isn't a shell script
   VITE_DEBUG_MNEMONIC=abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about
   ```

   And flip `utxoOnly` to `true` (revert after testing) in:
   - `web/src/lwk/index.ts` — last argument of `EsploraClient(...)`
   - `web/src/lib/wallet-core/store/walletCache.ts` — `.utxoOnly(false)` on
     the `WolletBuilder`

Connect the debug-mnemonic wallet, it should sync with no error.

> ⚠️ Every time you restart the regtest node (step 1), it's a brand new chain
> from genesis. The browser's persisted wallet cache (IndexedDB) doesn't know
> that and will try to apply an update against a chain state that no longer
> exists, failing with something like `Update height X too old`. Clear it
> before reconnecting: DevTools → Application → Storage → IndexedDB →
> delete `lwk-wallet-cache` (or just clear all site data for localhost).

---

## Why that's not the whole test

A fresh regtest wallet has zero history. Connecting to it proves the server
doesn't crash — it doesn't prove the fix does anything, because the bug only
shows up once a single address has **more than 100** transactions, and a
fresh wallet has none. On real testnet that address already existed
(that's literally how the bug was found); on regtest we have to build one
from scratch.

The rest of this doc is only for that: manufacturing an address with 100+
transactions but few unspent outputs, to actually watch the 400 turn into a
200. You don't need it to just run the fix — only to reproduce the specific
bug it fixes.

## Appendix: generating a 100+ tx address from scratch

This signs transactions as the exact wallet the web app derives from the
debug mnemonic above, so needs the LWK signer/wallet CLI (`lwk_cli`) — there's
no other way to spend from that specific address without its private key.

Install it somewhere convenient — anywhere works, this doc assumes `~/lwk`
below. **Skip this if you already have it cloned:**

```bash
git clone https://github.com/Blockstream/lwk ~/lwk
```

**Stay in your working terminal** (the one with `$PORT` set from "Run it" —
not the one running the waterfalls server, that one stays untouched). Then,
every time:

```bash
cd ~/lwk
git pull
cargo build -p lwk_cli --bin lwk_cli
echo "export LWK=~/lwk/target/debug/lwk_cli" >> /tmp/wf-env.sh
echo "export NETWORK=regtest" >> /tmp/wf-env.sh
```

Start its RPC server pointed at your local waterfalls — same terminal,
nothing was left running in it:

```bash
source /tmp/wf-env.sh
echo "PORT=$PORT"
"$LWK" -n regtest server start --server-type waterfalls \
  --server-url "http://127.0.0.1:$PORT" --datadir /tmp/lwk-cli-regtest \
  2>&1 | tee /tmp/lwk-cli-server.log
```

✅ Once you see `App running version ...` in the output, it's up.

**Stay in this terminal — don't touch it again.** It's now stuck running the
server, same as the waterfalls one.

**Open a new terminal.** The `lwk_cli` server printed its own local RPC
address on startup:

```bash
source /tmp/wf-env.sh
ADDR=$(grep -oE 'addr: [0-9.]+:[0-9]+' /tmp/lwk-cli-server.log | tail -1 | sed 's/addr: //')
echo "export ADDR='$ADDR'" >> /tmp/wf-env.sh
echo "ADDR=$ADDR"
```

That should print an actual `127.0.0.1:PORT`, not empty. Now load the
wallet — same working terminal:

```bash
source /tmp/wf-env.sh
MNEMONIC="abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

"$LWK" signer load-software --mnemonic "$MNEMONIC" --persist false --signer test
DESC=$("$LWK" signer singlesig-desc --signer test --descriptor-blinding-key slip77 --kind wpkh | jq -r .descriptor)
echo "export DESC='$DESC'" >> /tmp/wf-env.sh
echo "DESC=$DESC"

"$LWK" wallet load --descriptor "$DESC" --wallet test
"$LWK" wallet address --wallet test --index 0
```

That last command's address should match what the web app shows once
connected.

Now fund it 110 times and spend most of it back down, one output at a time,
so only a handful stay unspent. Needs `jq` and the elementsd node's own RPC
cookie/port (found via `ps aux`, since the node itself doesn't log them
anywhere else). Same working terminal:

```bash
source /tmp/wf-env.sh

TEST_PID=$(ps aux | grep '[i]ntegration-.*manual_persistent_server' | awk '{print $2}')
NODE_CMD=$(ps -eo pid,ppid,command | awk -v ppid="$TEST_PID" '$2==ppid' | grep elementsd)
NODE_DATADIR=$(echo "$NODE_CMD" | grep -oE -- '-datadir=[^ ]+' | cut -d= -f2)
NODE_RPCPORT=$(echo "$NODE_CMD" | grep -oE -- '-rpcport=[0-9]+' | cut -d= -f2)
echo "NODE_DATADIR=$NODE_DATADIR"
echo "NODE_RPCPORT=$NODE_RPCPORT"

if [ ! -f "$NODE_DATADIR/liquidregtest/.cookie" ]; then
  echo "STOP: no cookie file at $NODE_DATADIR/liquidregtest/.cookie — something's wrong, don't continue"
fi

COOKIE=$(cat "$NODE_DATADIR/liquidregtest/.cookie")
RPC_URL="http://127.0.0.1:$NODE_RPCPORT"
rpc() {
  curl -s -u "$COOKIE" --data-binary \
    "{\"jsonrpc\":\"1.0\",\"id\":\"x\",\"method\":\"$1\",\"params\":$2}" \
    -H 'content-type: text/plain;' "$RPC_URL"
}

ADDR0=$("$LWK" wallet address --wallet test --index 0 | jq -r .address)
echo "ADDR0=$ADDR0"

echo "funding: sending 110 deposits..."
for i in $(seq 1 110); do
  rpc "sendtoaddress" "[\"$ADDR0\", 0.00005000]" > /dev/null
  if (( i % 25 == 0 )); then echo "  ...$i/110"; fi
done
addr=$(rpc "getnewaddress" "[]" | jq -r .result)
rpc "generatetoaddress" "[6, \"$addr\"]" > /dev/null
echo "✅ funding done"

echo "spending down: 100 individual sends..."
for i in $(seq 1 100); do
  PSET=$("$LWK" wallet send --wallet test --recipient "burn:1000" | jq -r .pset)
  SIGNED=$("$LWK" signer sign --signer test --pset "$PSET" | jq -r .pset)
  "$LWK" wallet broadcast --wallet test --pset "$SIGNED" > /dev/null
  if (( i % 15 == 0 )); then
    echo "  ...$i/100"
    addr=$(rpc "getnewaddress" "[]" | jq -r .result)
    rpc "generatetoaddress" "[1, \"$addr\"]" > /dev/null
  fi
done
addr=$(rpc "getnewaddress" "[]" | jq -r .result)
rpc "generatetoaddress" "[3, \"$addr\"]" > /dev/null
echo "✅ DONE — $ADDR0 now has 110+ raw history entries and a handful of live UTXOs"
```

If `NODE_DATADIR=`/`NODE_RPCPORT=` print more than one line, or nothing,
you've got zero or multiple `elementsd` processes running (leftovers from an
earlier attempt) — `ps aux | grep elementsd` by hand, kill the stale ones,
keep only the one started in "Run it" step 1.

## Check on the frontend

Refresh the wallet in the web app (clear IndexedDB first if you restarted
the node — see the warning in step 2 above). Balance should load, no error.
That alone is the proof: before the fix this address would 400 with
`UtxoOnlyHistoryTooLarge`.

## Check via curl (optional, only if you want the raw numbers)

`waterfalls` refuses a descriptor with the blinding key in plaintext, so
strip the `ct(slip77(...),...)` wrapper off `$DESC` first:

```bash
source /tmp/wf-env.sh
DESC_RAW=$(echo "$DESC" | sed -E 's/^ct\(slip77\([^)]*\),(.*)\)#[^#]*$/\1/')
echo "DESC_RAW=$DESC_RAW"
```

Raw history count (page 0, should be well over 100):

```bash
source /tmp/wf-env.sh
DESC_RAW=$(echo "$DESC" | sed -E 's/^ct\(slip77\([^)]*\),(.*)\)#[^#]*$/\1/')
curl -sS -G --data-urlencode "descriptor=$DESC_RAW" --data-urlencode "to_index=5" \
  "http://127.0.0.1:$PORT/v2/waterfalls" \
  | jq '.txs_seen | to_entries[0].value[0] | length'
```

`utxo_only=true` — should print `200`, not `400`:

```bash
source /tmp/wf-env.sh
DESC_RAW=$(echo "$DESC" | sed -E 's/^ct\(slip77\([^)]*\),(.*)\)#[^#]*$/\1/')
curl -sS -w '\n%{http_code}\n' -G \
  --data-urlencode "descriptor=$DESC_RAW" --data-urlencode "to_index=5" --data-urlencode "utxo_only=true" \
  "http://127.0.0.1:$PORT/v2/waterfalls"
```

(`-G --data-urlencode` percent-encodes each value. The descriptor has raw
`[`, `]`, `<`, `>` in it, which aren't valid unencoded in a URL — building
the query string by hand (`?descriptor=$DESC_RAW&...`) sends those literally
and the server's HTTP parser rejects the whole request with an empty `400`
before your query ever reaches the actual route.)

On `master` instead of `fix/utxo-only-history-cap`, that last request 400s
with `UtxoOnlyHistoryTooLarge` once the raw count passes 100.
