const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function assertSolanaAddress(value: string, fieldName: string): string {
  if (!SOLANA_ADDRESS_PATTERN.test(value)) {
    throw new Error(`SOLANA_ADDRESS_INVALID:${fieldName}:${value}`);
  }
  return value;
}

export function isSolanaAddress(value: string): boolean {
  return SOLANA_ADDRESS_PATTERN.test(value);
}
