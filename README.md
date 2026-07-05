# @dex-pool-datasets

Multi-chain DEX dataset builder. Three separate dataset families, each with its own honesty guarantees:

1. **DEX pool candles** (`DEX_POOL`) — replay-compatible OHLCV candles built from real on-chain pool events. EVM (Uniswap-v3-style `eth_getLogs`) and Solana (AMM program transactions, see below) both produce this same dataset shape.
2. **Jupiter executions** (`JUPITER_EXECUTION`) — historical record of executed Jupiter-routed Solana swaps (input/output mint, amount, route legs), built from `getSignaturesForAddress`/`getTransaction` against the Jupiter aggregator program.
3. **Jupiter quote snapshots** (`JUPITER_QUOTE_SNAPSHOT`) — forward-only routing snapshots from the Jupiter quote API. Valid only from the moment you sample them; not a historical or replay-safe source.

Jupiter quotes tell you what the router would do *right now* — they are not a substitute for real pool event history. See [Solana & Jupiter datasets](#solana--jupiter-datasets) below.

```bash
dex-pool build base:WETH/USDC --fee 500 --days 30
```

No config file is required for normal EVM usage.

## Install

```bash
npm ci
npm run build
```

Run the compiled CLI:

```bash
npm run dex-pool -- build base:WETH/USDC --fee 500 --days 30
```

Or link it locally:

```bash
npm link
dex-pool build base:WETH/USDC --fee 500 --days 30
```

## Environment

Create `.env`:

```env
BASE_RPC_URL=https://your-base-archive-rpc
ETH_RPC_URL=https://your-ethereum-archive-rpc
ARBITRUM_RPC_URL=https://your-arbitrum-archive-rpc
POLYGON_RPC_URL=https://your-polygon-archive-rpc
SOLANA_RPC_URL=https://your-solana-rpc
```

The CLI loads `.env` automatically.

You can also pass RPC explicitly:

```bash
dex-pool build base:WETH/USDC --fee 500 --days 30 --rpc-env BASE_RPC_URL
dex-pool build base:WETH/USDC --fee 500 --days 30 --rpc https://your-rpc-url
```

## Quickstart

Build last 30 days:

```bash
BASE_RPC_URL=https://your-base-archive-rpc \
dex-pool build base:WETH/USDC --fee 500 --days 30
```

Build all supported timeframes:

```bash
BASE_RPC_URL=https://your-base-archive-rpc \
dex-pool build base:WETH/USDC --fee 500 --days 30 --all-timeframes
```

Preview without writing output:

```bash
dex-pool build base:WETH/USDC --fee 500 --days 30 --all-timeframes --dry-run
```

Build exact range:

```bash
BASE_RPC_URL=https://your-base-archive-rpc \
dex-pool build base:WETH/USDC \
  --fee 500 \
  --from 2025-12-02 \
  --to 2026-01-01 \
  --all-timeframes
```

`--to` is an exclusive cutoff.

## Selectors

Use:

```text
chain:PAIR
chain:POOL_ADDRESS
```

Examples:

```bash
dex-pool build base:WETH/USDC --fee 500 --days 30
dex-pool inspect base:WETH/USDC --fee 500
dex-pool inspect base:0xd0b53d9277642d899df5c87a3966a349a798f224
```

Explicit flags also work:

```bash
dex-pool build --chain base --pair WETH/USDC --fee 500 --days 30
dex-pool build --chain base --pool 0xd0b53d9277642d899df5c87a3966a349a798f224 --days 30
```

## Build

Default timeframes:

```text
1m,5m,15m,1h,4h
```

All supported timeframes:

```text
1m,3m,5m,15m,30m,1h,4h,1d
```

Build with custom output:

```bash
BASE_RPC_URL=https://your-base-archive-rpc \
dex-pool build base:WETH/USDC \
  --fee 500 \
  --days 30 \
  --all-timeframes \
  --out .tmp/dex-pool-datasets
```

If `--out` is omitted, the CLI chooses a deterministic local output path.

## Run

`run` is a short human-facing wrapper around direct build usage:

```bash
BASE_RPC_URL=https://your-base-archive-rpc \
dex-pool run base:WETH/USDC --fee 500 --days 30 --all-timeframes
```

`run` does not initialize or refresh discovery cache.

## Inspect / Doctor

Inspect a pair or pool:

```bash
BASE_RPC_URL=https://your-base-archive-rpc \
dex-pool inspect base:WETH/USDC --fee 500
```

Check RPC and chain health:

```bash
BASE_RPC_URL=https://your-base-archive-rpc \
dex-pool doctor base
```

## Discover pools

Discovery cache is explicit because initial indexing can take a long time.

```bash
BASE_RPC_URL=https://your-base-archive-rpc \
dex-pool discover-cache status base

BASE_RPC_URL=https://your-base-archive-rpc \
dex-pool discover-cache init base

BASE_RPC_URL=https://your-base-archive-rpc \
dex-pool discover-cache refresh base
```

After cache exists:

```bash
BASE_RPC_URL=https://your-base-archive-rpc \
dex-pool discover base --top 20 --by swapCount --lookback-days 7
```

Top pools by quote volume:

```bash
BASE_RPC_URL=https://your-base-archive-rpc \
dex-pool discover base \
  --top 20 \
  --by quoteVolume \
  --quote USDC \
  --lookback-days 7
```

Print build commands from discovery results:

```bash
BASE_RPC_URL=https://your-base-archive-rpc \
dex-pool discover base \
  --top 20 \
  --by quoteVolume \
  --quote USDC \
  --print-build-commands \
  --build-days 30 \
  --all-timeframes
```

## Output

The builder writes JSONL candles plus metadata:

```text
run-report.json
<pool-id>/
  <symbol>/
    1m.jsonl
    5m.jsonl
    15m.jsonl
    1h.jsonl
    4h.jsonl
    dex-quality.jsonl
    manifest.json
```

## Supported chains

| Chain    | Chain ID | RPC env            |
| -------- | -------: | ------------------ |
| Ethereum |      `1` | `ETH_RPC_URL`      |
| Base     |   `8453` | `BASE_RPC_URL`     |
| Arbitrum |  `42161` | `ARBITRUM_RPC_URL` |
| Polygon  |    `137` | `POLYGON_RPC_URL`  |
| BSC      |     `56` | `BSC_RPC_URL`      |
| Solana   |      n/a | `SOLANA_RPC_URL`   |

Solana has no `simple` mode (no factory/`getPool` equivalent to resolve a pair selector on-chain), so Solana pools go through the registry/config build path — see below.

## Solana & Jupiter datasets

### 1. Solana AMM pool candles (`DEX_POOL` / `SOLANA_AMM_STYLE`)

Real on-chain pool swaps, decoded via a transaction-wide token-balance-diff technique (no per-protocol instruction byte parsing) against a small allowlist of known AMM programs (Orca Whirlpool, Raydium AMM v4/CLMM/CPMM, Meteora DLMM/Dynamic AMM — see `src/solana/solana-amm-program-registry.ts`). This produces the exact same `DexPoolCandle`/candle-JSONL/manifest shape as the EVM path.

Solana pools build through the registry/config path (there's no on-chain factory to resolve a pair selector the way Uniswap v3 has):

```bash
SOLANA_RPC_URL=https://your-solana-rpc \
dex-pool build --registry-config config/dex-dataset.solana.example.json --verbose
```

The registry config references a separate pool-registry JSON (`config/dex-pools.solana.example.json`) with entries shaped like:

```json
{
  "id": "solana-raydium-ray-usdc",
  "chain": "solana",
  "dex": "raydium",
  "kind": "SOLANA_AMM_STYLE",
  "poolAddress": "6UmmUiYoBjSrhakAobJw8BvkmJtDVxaeBtbt7rxWo1mg",
  "programId": "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  "token0": { "symbol": "RAY", "address": "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", "decimals": 6 },
  "token1": { "symbol": "USDC", "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "decimals": 6 },
  "baseToken": "token0",
  "quoteToken": "token1",
  "startBlock": "430000000"
}
```

`startBlock`/`endBlock` (and the build config's `fromBlock`/`toBlock`) are Solana **slot** numbers for Solana pools.

**Known limitation:** for a multi-hop route where this pool is one of several legs, the transaction-wide balance diff reflects the whole route's net movement of the pool's two mints, not this leg's amount alone — there's no per-instruction balance snapshot to isolate it further without protocol-specific decoding. Direct (single-hop, single-pool) swaps are decoded exactly; see `src/solana/solana-pool-swap-reader.ts` for details.

### 2. Discover which pools matter (`jupiter-discover`)

Jupiter is used here purely as **routing/discovery context** — it tells you which pools are actually seeing volume so you know what to add to the registry above. It is never the candle source itself.

```bash
SOLANA_RPC_URL=https://your-solana-rpc \
dex-pool jupiter-discover \
  --input So11111111111111111111111111111111111111112 \
  --output 4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R \
  --amounts 100000000,1000000000,5000000000 \
  --symbols "SOL=So11111111111111111111111111111111111111112,RAY=4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R"
```

Route legs that resolve to a program in the known-AMM registry are printed as pool candidates (promote them into a registry file by adding `id`/`startBlock`); legs on unrecognized programs (private market makers, RFQ venues, newer AMMs) are reported separately rather than silently dropped — today's live routing landscape includes many venues beyond Orca/Raydium/Meteora.

### 3. Historical executed Jupiter swaps (`jupiter-executions`)

```bash
SOLANA_RPC_URL=https://your-solana-rpc \
dex-pool jupiter-executions --from-slot 430949000 --to-slot 430950000 --verbose
```

Writes `jupiter-executions.jsonl` + `jupiter-execution-quality.json` + `manifest.json` (`datasetType: JUPITER_EXECUTION`) with one record per executed swap: signature, slot, signer, input/output mint + amount, and recognized route legs. Input/output mint and amount are derived from the signing wallet's own token-balance deltas (plus native SOL lamport delta) — this is the whole-route net effect the trader experienced, not a per-leg breakdown.

Jupiter's on-chain volume is very high (order of 10+ transactions per slot at times) — size your slot range and RPC provider accordingly; a public shared RPC endpoint will rate-limit hard over more than a few hundred slots.

### 4. Forward-only quote snapshots (`jupiter-quotes`)

```bash
dex-pool jupiter-quotes \
  --pair So11111111111111111111111111111111111111112:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v:1000000000 \
  --interval-seconds 60 --duration-seconds 3600
```

Writes `jupiter-quote-snapshots.jsonl` + `manifest.json` (`datasetType: JUPITER_QUOTE_SNAPSHOT`). Explicitly **not historical** — every record is only valid from the moment it was sampled, and there is no way to backfill Jupiter quotes for the past.

## Backward compatibility

Config builds still work:

```bash
dex-pool build --config dex-pool.config.json
```

`--config` uses the simple chain/pair/fee-shaped config (EVM only). For the full network+registry+build JSON shape (`config/dex-dataset.*.example.json`) — required for Solana, optional for EVM — use `--registry-config` instead:

```bash
dex-pool build --registry-config config/dex-dataset.solana.example.json
```

New usage should prefer direct CLI commands:

```bash
dex-pool build base:WETH/USDC --fee 500 --days 30
```

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
```

## Cheat sheet

```bash
BASE_RPC_URL=... dex-pool build base:WETH/USDC --fee 500 --days 30
BASE_RPC_URL=... dex-pool build base:WETH/USDC --fee 500 --days 30 --all-timeframes
dex-pool build base:WETH/USDC --fee 500 --days 30 --dry-run
BASE_RPC_URL=... dex-pool run base:WETH/USDC --fee 500 --days 30
BASE_RPC_URL=... dex-pool inspect base:WETH/USDC --fee 500
BASE_RPC_URL=... dex-pool doctor base
BASE_RPC_URL=... dex-pool discover-cache status base
BASE_RPC_URL=... dex-pool discover-cache init base
BASE_RPC_URL=... dex-pool discover base --by quoteVolume --quote USDC --top 20
SOLANA_RPC_URL=... dex-pool build --registry-config config/dex-dataset.solana.example.json
SOLANA_RPC_URL=... dex-pool jupiter-discover --input <mint> --output <mint>
SOLANA_RPC_URL=... dex-pool jupiter-executions --from-slot <slot> --to-slot <slot>
dex-pool jupiter-quotes --pair <inputMint>:<outputMint>:<amount>
```
