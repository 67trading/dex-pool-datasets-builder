# @dex-pool-datasets

Build replay-compatible DEX pool candle datasets from on-chain Uniswap v3-style pool events.

```bash
dex-pool build base:WETH/USDC --fee 500 --days 30
```

No config file is required for normal usage.

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

## Backward compatibility

Config builds still work:

```bash
dex-pool build --config dex-pool.config.json
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
```
