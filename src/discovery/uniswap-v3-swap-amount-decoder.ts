import type { HexString } from "../evm/evm-json-rpc-client.js";
import { decodeSignedAbiWord } from "./abi-word-decoder.js";

export function decodeUniswapV3SwapAmounts(data: HexString): {
  amount0: bigint;
  amount1: bigint;
} {
  try {
    return {
      amount0: decodeSignedAbiWord(data, 0),
      amount1: decodeSignedAbiWord(data, 1),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`DISCOVERY_SWAP_LOG_INVALID:${message}`);
  }
}
