# Changelog

## Unreleased

### Breaking

- Discovery metadata is now RPC-only. `DexPoolSelectionMetadata.discoverySource`
  accepts `uniswap_v3_rpc`, and `discoveryMetric` accepts `swapCount` or
  `quoteVolume`. The previous subgraph source and USD/liquidity metric names are
  intentionally not part of this discovery surface.
