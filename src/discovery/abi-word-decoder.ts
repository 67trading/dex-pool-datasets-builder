import type { HexString } from "../evm/evm-json-rpc-client.js";

const WORD_HEX_LENGTH = 64;
const TWO_256 = 1n << 256n;
const TWO_255 = 1n << 255n;

export function decodeSignedAbiWord(
  data: HexString,
  wordIndex: number,
): bigint {
  const unsigned = BigInt(`0x${readAbiWord(data, wordIndex)}`);
  return unsigned >= TWO_255 ? unsigned - TWO_256 : unsigned;
}

export function readAbiWord(data: HexString, wordIndex: number): string {
  const hex = strip0x(data);
  const start = wordIndex * WORD_HEX_LENGTH;
  const word = hex.slice(start, start + WORD_HEX_LENGTH);

  if (word.length !== WORD_HEX_LENGTH) {
    throw new Error(`abi_word:${wordIndex}`);
  }

  return word;
}

export function decodeAddressAbiWord(word: string, field: string): HexString {
  if (word.length !== WORD_HEX_LENGTH) {
    throw new Error(`address_word:${field}:${word.length}`);
  }

  return `0x${word.slice(-40)}` as HexString;
}

function strip0x(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}
