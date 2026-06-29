import type { HexString } from "../evm/evm-json-rpc-client.js";

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as const;

export function assertEvmAddress(value: string, fieldName: string): HexString {
  if (!EVM_ADDRESS_PATTERN.test(value)) {
    throw new Error(`SIMPLE_ADDRESS_INVALID:${fieldName}:${value}`);
  }

  return value as HexString;
}

export function isZeroAddress(value: string): boolean {
  return value.toLowerCase() === ZERO_ADDRESS;
}
